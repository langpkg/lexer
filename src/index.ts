// @langpkg/lexer
//
// Made with ❤️ by Maysara.



// ╔════════════════════════════════════════ TYPE ════════════════════════════════════════╗

    /** Byte span: start and end positions in the input. */
    export interface Span {
        /** Byte offset from the start of the input. */
        readonly start      : number
        /** Byte offset after the match (exclusive). */
        readonly end        : number
    }

    /** A single token returned by next(). */
    export interface Token {
        /** Token type name as declared in the rule spec. */
        readonly type       : string
        /** Matched text -- transformed by value() if supplied, otherwise same as text. */
        readonly value      : string
        /** Raw matched text, always untransformed. */
        readonly text       : string
        /** Byte span of the match. */
        readonly span       : Span

        toString()          : string
    }

    /** Saved position -- pass to reset() to resume from a checkpoint. */
    export interface LexerState {
        readonly line       : number
        readonly col        : number
    }

    /** Keyword-to-type map for keywords(). */
    export type KeywordMap = Record<string, string | string[]>;

    /**
     * Type-transform function.
     * Return a string to override the token type,
     * or undefined to keep the rule's declared type.
     */
    export type TypeTransform = (text: string) => string | undefined;

    /** Full object form of a rule. */
    export interface RuleSpec {
        /** One or more patterns. Strings are exact literals; RegExps are patterns. */
        match               : Pattern | Pattern[]
        /** Required if the pattern can match a newline. The lexer validates this at compile time. */
        lineBreaks?         : boolean
        /** Emit an error token instead of throwing when this rule matches. */
        error?              : boolean
        /** Transform matched text before storing in token.value. */
        value?              : (text: string) => string
        /** Override the token type. Pass keywords({...}) here. */
        type?               : TypeTransform
    }

    /** Anything accepted as a rule value in the spec. */
    export type RuleValue =
        | Pattern
        | Pattern[]
        | RuleSpec
        | (Pattern | RuleSpec)[];

    /** A string literal or RegExp pattern. */
    export type Pattern = string | RegExp;

    /**
     * The spec object passed to compile().
     * Keys are token-type names; values describe what to match.
     *
     * Matching priority:
     *   1. Longer string literals always beat shorter ones ('===' > '=>' > '=').
     *   2. Among rules that share the same first character, RegExp rules run in
     *      declaration order after all string literals.
     */
    export type RulesSpec = Record<string, RuleValue>;

    // ---------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------

    interface CRule {
        readonly type           : string
        readonly re             : RegExp | null
        readonly lineBreaks     : boolean
        readonly error          : boolean
        readonly shouldThrow    : boolean
        readonly value          : ((s: string) => string) | null
        readonly typeXform      : TypeTransform | null
    }

    /**
     * One dispatch slot per ASCII charCode.
     *
     * fast: when exactly one candidate exists, re0/rule0 are set.
     *       next() uses them directly, skipping the loop.
     * slow: when 2+ candidates exist (e.g. '===', '=>', '='),
     *       candidates[] is tried in order.
     */
    interface Slot {
        readonly re0            : RegExp | null | undefined // undefined = use slow path
        readonly rule0          : CRule | undefined
        readonly candidates     : readonly { re: RegExp | null; rule: CRule }[]
    }

    interface DispatchTable {
        readonly slots          : readonly (Slot | null)[]  // indexed by charCode 0–127
        readonly highSlot       : Slot | null               // charCode >= 128
        readonly errorRule      : CRule
    }

// ╚══════════════════════════════════════════════════════════════════════════════════════╝



// ╔════════════════════════════════════════ HELP ════════════════════════════════════════╗

    const _ts = Object.prototype.toString;

    function isRE(o: unknown): o is RegExp {
        return !!o && _ts.call(o) === '[object RegExp]';
    }

    function isSpec(o: unknown): o is RuleSpec {
        return !!o && typeof o === 'object' && !isRE(o) && !Array.isArray(o);
    }

    function reEscape(s: string): string {
        return s.replace(/[-/\\^$*+?.()|[\]{}]/g, x => x === '-' ? '\\x2d' : '\\' + x);
    }

    function countNL(text: string): [count: number, lastIndex: number] {
        let n = 0, last = -1, i = -1;
        while ((i = text.indexOf('\n', i + 1)) !== -1) { n++; last = i; }
        return [n, last];
    }

    function tokenToString(this: Token): string { return this.value; }

    function calculateLineCol(buf: string, offset: number): { line: number; col: number } {
        let line = 1, col = 1;
        for (let i = 0; i < offset; i++) {
            if (buf[i] === '\n') { line++; col = 1; }
            else col++;
        }
        return { line, col };
    }

    function makeStickyRE(src: string, unicode: boolean): RegExp {
        return new RegExp('(?:' + src + ')', unicode ? 'yu' : 'y');
    }

    function validateRE(re: RegExp, typeName: string): void {
        if (re.ignoreCase)      throw new Error(`Rule '${typeName}': /i flag not allowed`);
        if (re.global)          throw new Error(`Rule '${typeName}': /g flag is implied`);
        if (re.sticky)          throw new Error(`Rule '${typeName}': /y flag is implied`);
        if (re.multiline)       throw new Error(`Rule '${typeName}': /m flag is implied`);
        if (new RegExp('|' + re.source).exec('')!.length > 1)
            throw new Error(`Rule '${typeName}': RegExp has capture groups -- use (?:…) instead`);
    }

    // ---------------------------------------------------------------------------
    // Probe cache
    //
    // Maps '<u:>regex.source' → which ASCII charCodes can start this pattern.
    // Shared across all compile() calls -- common patterns like /[a-z]+/ are
    // probed once ever, not once per compile().
    // ---------------------------------------------------------------------------

    const _probeCache = new Map<string, { ascii: Uint8Array; high: boolean }>();

    const _ALNUMS = 'abcdefghijklmnopqrstuvwxyz0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    function probePattern(re: RegExp, unicode: boolean): { ascii: Uint8Array; high: boolean } {
        const key = (unicode ? 'u:' : ':') + re.source;
        const hit = _probeCache.get(key);
        if (hit) return hit;

        let probe: RegExp;
        try { probe = new RegExp('^(?:' + re.source + ')', unicode ? 'u' : ''); }
        catch { return { ascii: new Uint8Array(128), high: false }; }

        const result = { ascii: new Uint8Array(128), high: false };

        for (let c = 0; c < 128; c++) {
            const ch = String.fromCharCode(c);
            probe.lastIndex = 0;
            // pad: ch × 8 + alnums so patterns like /\/\/[^\n]*/ find enough context
            if (probe.test(ch + ch.repeat(8) + _ALNUMS)) result.ascii[c] = 1;
        }

        probe.lastIndex = 0;
        result.high =
            probe.test('\u00e9\u00e9\u00e9' + _ALNUMS) ||
            probe.test('\u4e2d\u4e2d\u4e2d' + _ALNUMS);

        _probeCache.set(key, result);
        return result;
    }

    // ordered list of (typeName, RuleSpec)
    function flattenSpec(spec: RulesSpec): { typeName: string; s: RuleSpec }[] {
        const out: { typeName: string; s: RuleSpec }[] = [];

        for (const typeName of Object.getOwnPropertyNames(spec)) {
            const raw = spec[typeName];
            const items = Array.isArray(raw) ? raw : [raw];
            let pending: Pattern[] = [];

            const flush = (): void => {
                if (!pending.length) return;
                out.push({ typeName, s: { match: pending.slice() } });
                pending = [];
            };

            for (const item of items) {
                if (isSpec(item)) { flush(); out.push({ typeName, s: item }); }
                else pending.push(item as Pattern);
            }
            flush();
        }

        return out;
    }

    // CRules with per-rule sticky regex
    function compileEntries(
        entries: { typeName: string; s: RuleSpec }[],
        unicode: boolean,
    ): { rule: CRule; pats: Pattern[] }[] {
        return entries.map(({ typeName, s }) => {
            const pats: Pattern[] =
                s.error && !s.match
                    ? []
                    : (Array.isArray(s.match) ? s.match : [s.match]) as Pattern[];

            for (const p of pats) if (isRE(p)) validateRE(p, typeName);

            // build one combined sticky regex from all multi-char patterns
            const multiPats = pats.filter(p => !(typeof p === 'string' && p.length === 1));
            let re: RegExp | null = null;

            if (multiPats.length > 0) {
                const sorted = [...multiPats].sort((a, b) =>
                    typeof a === 'string' && typeof b === 'string' ? b.length - a.length
                        : isRE(a) ? 1 : isRE(b) ? -1 : 0
                );
                const src = sorted.map(p => typeof p === 'string' ? reEscape(p) : p.source).join('|');
                re = makeStickyRE(src, unicode);
                re.lastIndex = 0;

                if (re.test('')) {
                    re.lastIndex = 0;
                    throw new Error(`Rule '${typeName}': pattern matches empty string`);
                }
                re.lastIndex = 0;

                // validate lineBreaks using source + multiple probe strings
                if (!s.lineBreaks && !s.error) {
                    let hasNL = re.source.includes('\n');
                    if (!hasNL) {
                        const g = new RegExp(re.source, unicode ? 'gu' : 'g');
                        const probes = ['\n', 'a\nb', '\nfoo', 'bar\n', 'foo\nbar'];
                        outer: for (const hay of probes) {
                            g.lastIndex = 0;
                            let m: RegExpExecArray | null;
                            while ((m = g.exec(hay)) !== null) {
                                if (m[0].includes('\n')) { hasNL = true; break outer; }
                                if (m[0].length === 0) break;
                            }
                        }
                    }
                    if (hasNL) {
                        re.lastIndex = 0;
                        throw new Error(`Rule '${typeName}': can match \\n -- set lineBreaks: true`);
                    }
                }
                re.lastIndex = 0;
            }

            const rule: CRule = {
                type: typeName,
                re,
                lineBreaks: !!(s.lineBreaks || s.error),
                error: !!s.error,
                shouldThrow: false,
                value: s.value ?? null,
                typeXform: s.type ?? null,
            };
            return { rule, pats };
        });
    }

    // DispatchTable
    function buildTable(
        compiled: { rule: CRule; pats: Pattern[] }[],
        unicode: boolean,
    ): DispatchTable {
        interface Accum {
            A: { len: number; lit: string; rule: CRule }[]  // multi-char literals
            B: CRule[]                                             // regex rules
            C: CRule | null                                        // single-char literal
        }

        const acc: (Accum | null)[] = new Array(128).fill(null);
        const highA: { len: number; lit: string; rule: CRule }[] = [];
        const highB: CRule[] = [];

        const getSlot = (c: number): Accum => {
            if (!acc[c]) acc[c] = { A: [], B: [], C: null };
            return acc[c]!;
        };

        for (const { rule, pats } of compiled) {
            if (rule.error) continue;

            for (const p of pats) {
                if (typeof p === 'string') {
                    const c0 = p.charCodeAt(0);
                    if (p.length === 1) {
                        if (c0 < 128) getSlot(c0).C = rule;
                        else highA.push({ len: 1, lit: p, rule });
                    } else {
                        if (c0 < 128) getSlot(c0).A.push({ len: p.length, lit: p, rule });
                        else highA.push({ len: p.length, lit: p, rule });
                    }
                } else {
                    const { ascii, high } = probePattern(p, unicode);
                    for (let c = 0; c < 128; c++) {
                        if (ascii[c]) {
                            const s = getSlot(c);
                            if (!s.B.includes(rule)) s.B.push(rule);
                        }
                    }
                    if (high && !highB.includes(rule)) highB.push(rule);
                }
            }
        }

        const toSlot = (a: Accum): Slot => {
            const cands: { re: RegExp | null; rule: CRule }[] = [];

            // Phase A: multi-char literals, longest first
            a.A.sort((x, y) => y.len - x.len);
            for (const { lit, rule } of a.A)
                cands.push({ re: makeStickyRE(reEscape(lit), unicode), rule });

            // Phase B: regex rules in declaration order
            for (const rule of a.B)
                cands.push({ re: rule.re!, rule });

            // Phase C: single-char fallback (no regex needed)
            if (a.C) cands.push({ re: null, rule: a.C });

            if (cands.length === 1)
                return { re0: cands[0].re, rule0: cands[0].rule, candidates: cands };

            return { re0: undefined, rule0: undefined, candidates: cands };
        };

        const slots: (Slot | null)[] = new Array(128).fill(null);
        for (let c = 0; c < 128; c++) if (acc[c]) slots[c] = toSlot(acc[c]!);

        let highSlot: Slot | null = null;
        if (highA.length || highB.length) {
            highA.sort((a, b) => b.len - a.len);
            const cands: { re: RegExp | null; rule: CRule }[] = [];
            for (const { lit, rule } of highA) cands.push({ re: makeStickyRE(reEscape(lit), unicode), rule });
            for (const rule of highB) cands.push({ re: rule.re!, rule });
            const single = cands.length === 1;
            highSlot = {
                re0: single ? cands[0].re : undefined,
                rule0: single ? cands[0].rule : undefined,
                candidates: cands,
            };
        }

        const defaultError: CRule = {
            type: 'error', re: null, lineBreaks: true, error: true,
            shouldThrow: true, value: null, typeXform: null,
        };
        const userError = compiled.find(e => e.rule.error)?.rule;
        return { slots, highSlot, errorRule: userError ?? defaultError };
    }

// ╚══════════════════════════════════════════════════════════════════════════════════════╝



// ╔════════════════════════════════════════ MAIN ════════════════════════════════════════╗

    /**
     * Build a type-transform that remaps matched identifiers to keyword types.
     * Ensures the longest-match principle -- 'className' will never be split
     * into 'class' + 'Name'.
     */
    export function keywords(map: KeywordMap): TypeTransform {
        const lookup = new Map<string, string>();
        for (const t of Object.getOwnPropertyNames(map)) {
            for (const kw of ([] as string[]).concat(map[t])) {
                if (typeof kw !== 'string')
                    throw new Error(`keywords(): value must be a string (in '${t}')`);
                lookup.set(kw, t);
            }
        }
        return k => lookup.get(k);
    }

    /** A compiled lexer. Create one with compile(). */
    export class Lexer {
        private readonly _dt    : DispatchTable;
        private _buf            : string = '';
        private _pos            : number = 0;
        private _line           : number = 1;
        private _col            : number = 1;

        /** @internal */
        constructor(dt: DispatchTable) { this._dt = dt; }

        /**
         * Load new input.
         * Optionally pass a LexerState from save() to resume from a checkpoint.
         * Returns `this` so you can chain: lexer.reset(src).next()
         */
        reset(input = '', state?: LexerState): this {
            this._buf   = input;
            this._pos   = 0;
            this._line  = state?.line ?? 1;
            this._col   = state?.col ?? 1;
            return this;
        }

        /** Snapshot current line/col for later reset(). */
        save(): LexerState {
            return { line: this._line, col: this._col };
        }

        /** Return the next Token, or undefined at EOF. */
        next(): Token | undefined {
            const buf = this._buf;
            const pos = this._pos;
            if (pos === buf.length) return undefined;

            const { slots, highSlot, errorRule } = this._dt;
            const code = buf.charCodeAt(pos);
            const slot = code < 128 ? slots[code] : highSlot;

            if (!slot) return this._emit(errorRule, buf[pos], pos);

            // fast path -- single candidate, no loop
            if (slot.rule0 !== undefined) {
                const re = slot.re0!;
                const rule = slot.rule0;
                if (re === null) return this._emit(rule, buf[pos], pos);
                re.lastIndex = pos;
                if (re.test(buf)) return this._emit(rule, buf.slice(pos, re.lastIndex), pos);
                return this._emit(errorRule, buf[pos], pos);
            }

            // slow path -- try candidates in order
            for (const { re, rule } of slot.candidates) {
                if (re === null) return this._emit(rule, buf[pos], pos);
                re.lastIndex = pos;
                if (re.test(buf)) return this._emit(rule, buf.slice(pos, re.lastIndex), pos);
            }

            return this._emit(errorRule, buf[pos], pos);
        }

        /** Return a human-readable error string with file position. */
        formatError(token: Token, message = 'invalid syntax'): string {
            const { line, col } = calculateLineCol(this._buf, token.span.start);
            return `${message} at line ${line} col ${col}`;
        }

        private _emit(rule: CRule, text: string, offset: number): Token {
            let lineBreaks = 0, lastNL = -1;
            if (rule.lineBreaks) [lineBreaks, lastNL] = countNL(text);

            const token: Token = {
                type        : rule.typeXform ? (rule.typeXform(text) ?? rule.type) : rule.type,
                value       : rule.value ? rule.value(text) : text,
                text,
                toString    : tokenToString,
                span        : { start: offset, end: offset + text.length },
            };

            this._pos += text.length;
            if (lineBreaks > 0) {
                this._line += lineBreaks;
                this._col = text.length - (lastNL + 1) + 1;
            } else {
                this._col += text.length;
            }

            if (rule.shouldThrow)
                throw new Error(this.formatError(token, 'invalid syntax'));

            return token;
        }
    }

    /**
     * Compile a rule spec into a Lexer.
     *
     * Rules are matched in declaration order.
     * String literals always beat shorter ones ('===' wins over '=' regardless of order).
     * RegExp rules for the same first character run in declaration order.
     */
    export function compile(spec: RulesSpec): Lexer {
        const entries = flattenSpec(spec);
        const unicode = entries.some(({ s }) => {
            const ps = s.match ? (Array.isArray(s.match) ? s.match : [s.match]) as Pattern[] : [];
            return ps.some(p => isRE(p) && p.unicode);
        });
        return new Lexer(buildTable(compileEntries(entries, unicode), unicode));
    }

// ╚══════════════════════════════════════════════════════════════════════════════════════╝



// ╔════════════════════════════════════════ ════ ════════════════════════════════════════╗

    export default { compile, keywords };

// ╚══════════════════════════════════════════════════════════════════════════════════════╝
