/** Byte span: start and end positions in the input. */
interface Span {
    /** Byte offset from the start of the input. */
    readonly start: number;
    /** Byte offset after the match (exclusive). */
    readonly end: number;
}
/** A single token returned by next(). */
interface Token {
    /** Token type name as declared in the rule spec. */
    readonly type: string;
    /** Matched text -- transformed by value() if supplied, otherwise same as text. */
    readonly value: string;
    /** Raw matched text, always untransformed. */
    readonly text: string;
    /** Byte span of the match. */
    readonly span: Span;
    /** Number of newlines in the match. Always 0 unless the rule sets lineBreaks: true. */
    readonly lineBreaks: number;
    toString(): string;
}
/** Saved position -- pass to reset() to resume from a checkpoint. */
interface LexerState {
    readonly line: number;
    readonly col: number;
}
/** Keyword-to-type map for keywords(). */
type KeywordMap = Record<string, string | string[]>;
/**
 * Type-transform function.
 * Return a string to override the token type,
 * or undefined to keep the rule's declared type.
 */
type TypeTransform = (text: string) => string | undefined;
/** Full object form of a rule. */
interface RuleSpec {
    /** One or more patterns. Strings are exact literals; RegExps are patterns. */
    match: Pattern | Pattern[];
    /** Required if the pattern can match a newline. The lexer validates this at compile time. */
    lineBreaks?: boolean;
    /** Emit an error token instead of throwing when this rule matches. */
    error?: boolean;
    /** Transform matched text before storing in token.value. */
    value?: (text: string) => string;
    /** Override the token type. Pass keywords({...}) here. */
    type?: TypeTransform;
}
/** Anything accepted as a rule value in the spec. */
type RuleValue = Pattern | Pattern[] | RuleSpec | (Pattern | RuleSpec)[];
/** A string literal or RegExp pattern. */
type Pattern = string | RegExp;
/**
 * The spec object passed to compile().
 * Keys are token-type names; values describe what to match.
 *
 * Matching priority:
 *   1. Longer string literals always beat shorter ones ('===' > '=>' > '=').
 *   2. Among rules that share the same first character, RegExp rules run in
 *      declaration order after all string literals.
 */
type RulesSpec = Record<string, RuleValue>;
interface CRule {
    readonly type: string;
    readonly re: RegExp | null;
    readonly lineBreaks: boolean;
    readonly error: boolean;
    readonly shouldThrow: boolean;
    readonly value: ((s: string) => string) | null;
    readonly typeXform: TypeTransform | null;
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
    readonly re0: RegExp | null | undefined;
    readonly rule0: CRule | undefined;
    readonly candidates: readonly {
        re: RegExp | null;
        rule: CRule;
    }[];
}
interface DispatchTable {
    readonly slots: readonly (Slot | null)[];
    readonly highSlot: Slot | null;
    readonly errorRule: CRule;
}
/**
 * Build a type-transform that remaps matched identifiers to keyword types.
 * Ensures the longest-match principle -- 'className' will never be split
 * into 'class' + 'Name'.
 */
declare function keywords(map: KeywordMap): TypeTransform;
/** A compiled lexer. Create one with compile(). */
declare class Lexer {
    private readonly _dt;
    private _buf;
    private _pos;
    private _line;
    private _col;
    /** @internal */
    constructor(dt: DispatchTable);
    /**
     * Load new input.
     * Optionally pass a LexerState from save() to resume from a checkpoint.
     * Returns `this` so you can chain: lexer.reset(src).next()
     */
    reset(input?: string, state?: LexerState): this;
    /** Snapshot current line/col for later reset(). */
    save(): LexerState;
    /** Return the next Token, or undefined at EOF. */
    next(): Token | undefined;
    /** Return a human-readable error string with file position. */
    formatError(token: Token, message?: string): string;
    private _emit;
}
/**
 * Compile a rule spec into a Lexer.
 *
 * Rules are matched in declaration order.
 * String literals always beat shorter ones ('===' wins over '=' regardless of order).
 * RegExp rules for the same first character run in declaration order.
 */
declare function compile(spec: RulesSpec): Lexer;
declare const _default: {
    compile: typeof compile;
    keywords: typeof keywords;
};

export { type KeywordMap, Lexer, type LexerState, type Pattern, type RuleSpec, type RuleValue, type RulesSpec, type Span, type Token, type TypeTransform, compile, _default as default, keywords };
