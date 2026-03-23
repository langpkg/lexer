// test/index.test.ts
//
// Made with ❤️ by Maysara.



// ╔════════════════════════════════════════ PACK ════════════════════════════════════════╗

    import { describe, test, expect } from 'bun:test';
    import { compile, keywords, Lexer, type Token, type LexerState } from '../src/index.js';

// ╚══════════════════════════════════════════════════════════════════════════════════════╝



// ╔════════════════════════════════════════ HELP ════════════════════════════════════════╗

    /** Lex `src` and return array of `"TYPE:value"` strings. */
    function lex(lexer: Lexer, src: string): string[] {
        lexer.reset(src);
        const out: string[] = [];
        let t: Token | undefined;
        while ((t = lexer.next()) !== undefined) out.push(`${t.type}:${t.value}`);
        return out;
    }

    /** Lex `src` and return full Token objects. */
    function lexFull(lexer: Lexer, src: string): Token[] {
        lexer.reset(src);
        const out: Token[] = [];
        let t: Token | undefined;
        while ((t = lexer.next()) !== undefined) out.push(t);
        return out;
    }

// ╚══════════════════════════════════════════════════════════════════════════════════════╝



// ╔════════════════════════════════════════ INIT ════════════════════════════════════════╗

    const jsLexer = compile({
        WS: /[ \t\r]+/,
        NL: { match: /\n/, lineBreaks: true },
        COMMENT: /\/\/[^\n]*/,
        NUMBER: /0|[1-9][0-9]*/,
        STRING: { match: /"(?:\\.|[^"\\])*"/, lineBreaks: false },
        IDENT: {
            match: /[a-zA-Z_$][a-zA-Z0-9_$]*/, type: keywords({
                KW: ['if', 'else', 'while', 'for', 'return', 'function', 'const', 'let', 'var'],
            })
        },
        // multi-char operators -- same first char stress test
        EQ3: '===',
        NEQ: '!==',
        ARROW: '=>',
        GTE: '>=',
        LTE: '<=',
        AND: '&&',
        OR: '||',
        // single-char operators / punctuation
        ASSIGN: '=',
        PLUS: '+',
        MINUS: '-',
        STAR: '*',
        SLASH: '/',
        BANG: '!',
        GT: '>',
        LT: '<',
        LPAREN: '(',
        RPAREN: ')',
        LBRACE: '{',
        RBRACE: '}',
        LBRACK: '[',
        RBRACK: ']',
        SEMI: ';',
        COMMA: ',',
        DOT: '.',
        COLON: ':',
    });

// ╚══════════════════════════════════════════════════════════════════════════════════════╝



// ╔════════════════════════════════════════ TEST ════════════════════════════════════════╗

    // ---------------------------------------------------------------------------
    // 1. Basic token recognition
    // ---------------------------------------------------------------------------

    describe('basic token recognition', () => {
        test('whitespace', () => {
            expect(lex(jsLexer, '  \t ')).toEqual(['WS:  \t ']);
        });

        test('newline', () => {
            const toks = lexFull(jsLexer, '\n');
            expect(toks[0].type).toBe('NL');
            expect(toks[0].lineBreaks).toBe(1);
        });

        test('line comment', () => {
            expect(lex(jsLexer, '// hello world')).toEqual(['COMMENT:// hello world']);
        });

        test('integer numbers', () => {
            expect(lex(jsLexer, '0 1 42 999')).toEqual([
                'NUMBER:0', 'WS: ', 'NUMBER:1', 'WS: ', 'NUMBER:42', 'WS: ', 'NUMBER:999',
            ]);
        });

        test('string literal', () => {
            expect(lex(jsLexer, '"hello"')).toEqual(['STRING:"hello"']);
        });

        test('identifier', () => {
            expect(lex(jsLexer, 'foo _bar $baz foo123')).toEqual([
                'IDENT:foo', 'WS: ', 'IDENT:_bar', 'WS: ', 'IDENT:$baz', 'WS: ', 'IDENT:foo123',
            ]);
        });

        test('all single-char punctuation', () => {
            expect(lex(jsLexer, '(){}[];,.')).toEqual([
                'LPAREN:(', 'RPAREN:)', 'LBRACE:{', 'RBRACE:}', 'LBRACK:[', 'RBRACK:]', 'SEMI:;', 'COMMA:,', 'DOT:.',
            ]);
        });
    });

    // ---------------------------------------------------------------------------
    // 2. Multi-char operators -- same-first-char disambiguation
    // ---------------------------------------------------------------------------

    describe('same-first-char disambiguation', () => {
        test('=== vs => vs =', () => {
            expect(lex(jsLexer, 'a===b')).toContain('EQ3:===');
            expect(lex(jsLexer, 'a=>b')).toContain('ARROW:=>');
            expect(lex(jsLexer, 'a=b')).toContain('ASSIGN:=');
        });

        test('!== vs !', () => {
            expect(lex(jsLexer, 'a!==b')).toContain('NEQ:!==');
            expect(lex(jsLexer, '!a')).toContain('BANG:!');
        });

        test('>= vs >', () => {
            expect(lex(jsLexer, 'a>=b')).toContain('GTE:>=');
            expect(lex(jsLexer, 'a>b')).toContain('GT:>');
        });

        test('<= vs <', () => {
            expect(lex(jsLexer, 'a<=b')).toContain('LTE:<=');
            expect(lex(jsLexer, 'a<b')).toContain('LT:<');
        });

        test('&& vs single &  (error)', () => {
            expect(lex(jsLexer, 'a&&b')).toContain('AND:&&');
        });

        test('|| vs single |  (error)', () => {
            expect(lex(jsLexer, 'a||b')).toContain('OR:||');
        });

        test('all ops in one expression', () => {
            const toks = lex(jsLexer, 'a===b!==c&&d||e>=f<=g');
            expect(toks).toContain('EQ3:===');
            expect(toks).toContain('NEQ:!==');
            expect(toks).toContain('AND:&&');
            expect(toks).toContain('OR:||');
            expect(toks).toContain('GTE:>=');
            expect(toks).toContain('LTE:<=');
        });
    });

    // ---------------------------------------------------------------------------
    // 3. Comment vs division -- regex rule before single-char literal
    // ---------------------------------------------------------------------------

    describe('comment vs slash', () => {
        test('line comment is one token', () => {
            expect(lex(jsLexer, '// this is a comment')).toEqual(['COMMENT:// this is a comment']);
        });

        test('division is SLASH', () => {
            expect(lex(jsLexer, 'a / b')).toContain('SLASH:/');
            expect(lex(jsLexer, 'a / b')).not.toContain('COMMENT:/');
        });

        test('comment then division on next line', () => {
            const toks = lex(jsLexer, '// note\na / b');
            expect(toks[0]).toBe('COMMENT:// note');
            expect(toks).toContain('SLASH:/');
        });

        test('division does not consume rest of line', () => {
            const toks = lex(jsLexer, 'x / y + z');
            expect(toks).toEqual([
                'IDENT:x', 'WS: ', 'SLASH:/', 'WS: ', 'IDENT:y', 'WS: ', 'PLUS:+', 'WS: ', 'IDENT:z',
            ]);
        });
    });

    // ---------------------------------------------------------------------------
    // 4. Keywords
    // ---------------------------------------------------------------------------

    describe('keywords', () => {
        test('all keywords resolve to KW', () => {
            const kws = ['if', 'else', 'while', 'for', 'return', 'function', 'const', 'let', 'var'];
            for (const kw of kws) {
                expect(lex(jsLexer, kw)).toEqual([`KW:${kw}`]);
            }
        });

        test('keyword prefix is still an identifier', () => {
            expect(lex(jsLexer, 'ifx')).toEqual(['IDENT:ifx']);
            expect(lex(jsLexer, 'returnValue')).toEqual(['IDENT:returnValue']);
            expect(lex(jsLexer, 'forLoop')).toEqual(['IDENT:forLoop']);
        });

        test('keyword in expression', () => {
            const toks = lex(jsLexer, 'if (x) return x');
            expect(toks[0]).toBe('KW:if');
            expect(toks).toContain('KW:return');
            expect(toks).not.toContain('IDENT:if');
        });
    });

    // ---------------------------------------------------------------------------
    // 5. String edge cases
    // ---------------------------------------------------------------------------

    describe('string literals', () => {
        test('empty string', () => {
            expect(lex(jsLexer, '""')).toEqual(['STRING:""']);
        });

        test('string with spaces', () => {
            expect(lex(jsLexer, '"hello world"')).toEqual(['STRING:"hello world"']);
        });

        test('string with escaped quote', () => {
            expect(lex(jsLexer, '"say \\"hi\\""')).toEqual(['STRING:"say \\"hi\\""']);
        });

        test('string with escaped backslash', () => {
            expect(lex(jsLexer, '"back\\\\slash"')).toEqual(['STRING:"back\\\\slash"']);
        });

        test('consecutive strings', () => {
            expect(lex(jsLexer, '"a""b"')).toEqual(['STRING:"a"', 'STRING:"b"']);
        });

        test('string does not swallow semicolon', () => {
            const toks = lex(jsLexer, '"hello";');
            expect(toks[0]).toBe('STRING:"hello"');
            expect(toks[1]).toBe('SEMI:;');
        });
    });

    // ---------------------------------------------------------------------------
    // 6. Line/col tracking
    // ---------------------------------------------------------------------------

    describe('line and col tracking', () => {
        test('single line -- col advances correctly', () => {
            const toks = lexFull(jsLexer, 'ab cd');
            expect(toks[0]).toMatchObject({ type: 'IDENT', value: 'ab', line: 1, col: 1 });
            expect(toks[1]).toMatchObject({ type: 'WS', value: ' ', line: 1, col: 3 });
            expect(toks[2]).toMatchObject({ type: 'IDENT', value: 'cd', line: 1, col: 4 });
        });

        test('newline increments line, resets col', () => {
            const toks = lexFull(jsLexer, 'a\nb');
            expect(toks[0]).toMatchObject({ type: 'IDENT', line: 1, col: 1 });
            expect(toks[1]).toMatchObject({ type: 'NL', line: 1, col: 2 });
            expect(toks[2]).toMatchObject({ type: 'IDENT', line: 2, col: 1 });
        });

        test('multiple newlines', () => {
            // 'a\n\nb' → [IDENT:a, NL, NL, IDENT:b] = indices 0-3
            const toks = lexFull(jsLexer, 'a\n\nb');
            expect(toks[3]).toMatchObject({ type: 'IDENT', value: 'b', line: 3, col: 1 });
        });

        test('offset is always byte position', () => {
            const toks = lexFull(jsLexer, 'ab cd');
            expect(toks[0].offset).toBe(0);
            expect(toks[1].offset).toBe(2);
            expect(toks[2].offset).toBe(3);
        });
    });

    // ---------------------------------------------------------------------------
    // 7. save() / reset() -- checkpoint / resume
    // ---------------------------------------------------------------------------

    describe('save and reset', () => {
        test('save captures line and col', () => {
            jsLexer.reset('a\nb');
            jsLexer.next();  // IDENT:a
            jsLexer.next();  // NL
            const state: LexerState = jsLexer.save();
            expect(state.line).toBe(2);
            expect(state.col).toBe(1);
        });

        test('reset with saved state resumes position info', () => {
            const state: LexerState = { line: 5, col: 3 };
            jsLexer.reset('x', state);
            const t = jsLexer.next()!;
            expect(t.line).toBe(5);
            expect(t.col).toBe(3);
        });

        test('reset without state starts at line 1 col 1', () => {
            jsLexer.reset('x');
            const t = jsLexer.next()!;
            expect(t.line).toBe(1);
            expect(t.col).toBe(1);
        });

        test('reset mid-stream restarts from beginning', () => {
            jsLexer.reset('abc');
            jsLexer.next();
            jsLexer.reset('xyz');
            const t = jsLexer.next()!;
            expect(t.value).toBe('xyz');
            expect(t.offset).toBe(0);
        });
    });

    // ---------------------------------------------------------------------------
    // 8. EOF behaviour
    // ---------------------------------------------------------------------------

    describe('EOF', () => {
        test('next() returns undefined at EOF', () => {
            jsLexer.reset('x');
            jsLexer.next();
            expect(jsLexer.next()).toBeUndefined();
        });

        test('repeated next() after EOF keeps returning undefined', () => {
            jsLexer.reset('x');
            jsLexer.next();
            expect(jsLexer.next()).toBeUndefined();
            expect(jsLexer.next()).toBeUndefined();
        });

        test('empty input immediately returns undefined', () => {
            jsLexer.reset('');
            expect(jsLexer.next()).toBeUndefined();
        });
    });

    // ---------------------------------------------------------------------------
    // 9. Token shape
    // ---------------------------------------------------------------------------

    describe('token shape', () => {
        test('token has all required fields', () => {
            jsLexer.reset('42');
            const t = jsLexer.next()!;
            expect(t).toHaveProperty('type');
            expect(t).toHaveProperty('value');
            expect(t).toHaveProperty('text');
            expect(t).toHaveProperty('offset');
            expect(t).toHaveProperty('lineBreaks');
            expect(t).toHaveProperty('line');
            expect(t).toHaveProperty('col');
        });

        test('toString() returns value', () => {
            jsLexer.reset('42');
            const t = jsLexer.next()!;
            expect(t.toString()).toBe('42');
            expect(String(t)).toBe('42');
        });

        test('text and value are identical without a value transform', () => {
            jsLexer.reset('"hello"');
            const t = jsLexer.next()!;
            expect(t.text).toBe(t.value);
        });
    });

    // ---------------------------------------------------------------------------
    // 10. value() transform
    // ---------------------------------------------------------------------------

    describe('value transform', () => {
        test('value() strips string delimiters', () => {
            const lex2 = compile({
                STR: { match: /"[^"]*"/, value: s => s.slice(1, -1) },
            });
            lex2.reset('"hello"');
            const t = lex2.next()!;
            expect(t.value).toBe('hello');
            expect(t.text).toBe('"hello"');
        });

        test('value() applies to every match', () => {
            const lex2 = compile({
                NUM: { match: /[0-9]+/, value: s => String(Number(s) * 2) },
                WS: /[ ]+/,
            });
            lex2.reset('3 7');
            const toks = lexFull(lex2, '3 7');
            expect(toks[0].value).toBe('6');
            expect(toks[2].value).toBe('14');
        });
    });

    // ---------------------------------------------------------------------------
    // 11. Error handling
    // ---------------------------------------------------------------------------

    describe('error handling', () => {
        test('unknown character throws by default', () => {
            expect(() => {
                jsLexer.reset('@');
                jsLexer.next();
            }).toThrow('invalid syntax');
        });

        test('custom error rule returns token instead of throwing', () => {
            const lex2 = compile({
                NUM: /[0-9]+/,
                ERR: { match: /./, error: true },
            });
            lex2.reset('@');
            const t = lex2.next()!;
            expect(t.type).toBe('ERR');
            expect(t.value).toBe('@');
        });

        test('error token is emitted per unrecognised char', () => {
            const lex2 = compile({
                NUM: /[0-9]+/,
                ERR: { match: /./, error: true },
            });
            lex2.reset('@@');
            // Each unrecognised char emits one error token, then the next char is tried fresh
            const t1 = lex2.next()!;
            expect(t1.type).toBe('ERR');
            expect(t1.value).toBe('@');
            const t2 = lex2.next()!;
            expect(t2.type).toBe('ERR');
            expect(t2.value).toBe('@');
            expect(lex2.next()).toBeUndefined();
        });

        test('formatError returns readable string', () => {
            jsLexer.reset('x');
            const t = jsLexer.next()!;
            const msg = jsLexer.formatError(t, 'unexpected');
            expect(msg).toContain('unexpected');
            expect(msg).toContain('line 1');
            expect(msg).toContain('col 1');
        });
    });

    // ---------------------------------------------------------------------------
    // 12. Compile-time validation
    // ---------------------------------------------------------------------------

    describe('compile-time validation', () => {
        test('throws on /i flag', () => {
            expect(() => compile({ A: /foo/i })).toThrow('/i flag not allowed');
        });

        test('throws on /g flag', () => {
            expect(() => compile({ A: /foo/g })).toThrow('/g flag is implied');
        });

        test('throws on /y flag', () => {
            expect(() => compile({ A: /foo/y })).toThrow('/y flag is implied');
        });

        test('throws on capture groups', () => {
            expect(() => compile({ A: /(foo)/ })).toThrow('capture groups');
        });

        test('throws on pattern matching newline without lineBreaks', () => {
            expect(() => compile({ A: /foo|bar\n/ })).toThrow('lineBreaks');
        });

        test('throws on pattern matching newline via character class without lineBreaks', () => {
            expect(() => compile({ A: /[\s]/ })).toThrow('lineBreaks');
        });

        test('validates lineBreaks with probe strings for multi-char string patterns', () => {
            // Multiple multi-char string literals create multiPats scenario.
            // None contain literal \n, so validation probes the compiled regex.
            expect(() => compile({ KW: ['if', 'else', 'while'] })).not.toThrow();
        });

        test('throws on empty-matching pattern', () => {
            expect(() => compile({ A: /a*/ })).toThrow('empty string');
        });

        test('allows /u flag', () => {
            expect(() => compile({ A: /\p{L}+/u })).not.toThrow();
        });
    });

    // ---------------------------------------------------------------------------
    // 13. keywords() helper
    // ---------------------------------------------------------------------------

    describe('keywords()', () => {
        test('single keyword type', () => {
            const lex2 = compile({
                IDENT: { match: /[a-z]+/, type: keywords({ IF: 'if' }) },
                WS: /[ ]+/,
            });
            lex2.reset('if foo');
            const toks = lexFull(lex2, 'if foo');
            expect(toks[0].type).toBe('IF');
            expect(toks[2].type).toBe('IDENT');
        });

        test('multiple keywords under one type', () => {
            const lex2 = compile({
                IDENT: { match: /[a-z]+/, type: keywords({ KW: ['if', 'else', 'while'] }) },
            });
            for (const kw of ['if', 'else', 'while']) {
                lex2.reset(kw);
                expect(lex2.next()!.type).toBe('KW');
            }
        });

        test('non-keyword falls back to IDENT type', () => {
            const lex2 = compile({
                IDENT: { match: /[a-z]+/, type: keywords({ KW: 'if' }) },
            });
            lex2.reset('foo');
            expect(lex2.next()!.type).toBe('IDENT');
        });

        test('throws if keyword is not a string', () => {
            expect(() => keywords({ KW: 42 as unknown as string })).toThrow();
        });
    });

    // ---------------------------------------------------------------------------
    // 14. Realistic programs
    // ---------------------------------------------------------------------------

    describe('realistic programs', () => {
        test('function declaration', () => {
            const toks = lex(jsLexer, 'function add(a, b) { return a + b; }');
            expect(toks).toContain('KW:function');
            expect(toks).toContain('IDENT:add');
            expect(toks).toContain('KW:return');
            expect(toks).toContain('PLUS:+');
        });

        test('for loop with comment', () => {
            const src = 'for (let i = 0; i < 10; i++) { // loop\n  x += i;\n}';
            // should not throw
            expect(() => {
                jsLexer.reset(src);
                // eslint-disable-next-line no-empty
                while (jsLexer.next() !== undefined) { }
            }).not.toThrow();
        });

        test('object literal', () => {
            const toks = lex(jsLexer, '{ key: "value", num: 42 }');
            expect(toks).toContain('COLON::');
            expect(toks).toContain('STRING:"value"');
            expect(toks).toContain('NUMBER:42');
        });

        test('chained method call', () => {
            const toks = lex(jsLexer, 'arr.map(x => x + 1)');
            expect(toks).toContain('DOT:.');
            expect(toks).toContain('ARROW:=>');
        });

        test('multiline program token count is stable', () => {
            const src = [
                'const x = 1;',
                'const y = 2;',
                'function sum(a, b) { return a + b; }',
                'const z = sum(x, y);',
            ].join('\n');

            jsLexer.reset(src);
            let count = 0;
            while (jsLexer.next() !== undefined) count++;

            // run again -- must be identical
            jsLexer.reset(src);
            let count2 = 0;
            while (jsLexer.next() !== undefined) count2++;

            expect(count).toBe(count2);
        });
    });

    // ---------------------------------------------------------------------------
    // 15. Non-ASCII (unicode)
    // ---------------------------------------------------------------------------

    describe('unicode / non-ASCII', () => {
        test('/u flag lexer matches unicode letters', () => {
            const lex2 = compile({
                WORD: /\p{L}+/u,
                WS: /[ ]+/,
            });
            lex2.reset('héllo wörld');
            const toks = lexFull(lex2, 'héllo wörld');
            expect(toks[0].type).toBe('WORD');
            expect(toks[0].value).toBe('héllo');
            expect(toks[2].value).toBe('wörld');
        });
    });

// ╚══════════════════════════════════════════════════════════════════════════════════════╝
