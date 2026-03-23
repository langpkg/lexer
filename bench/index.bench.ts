// bench/index.bench.ts
//
// Run      : bun run bench
// devDeps  : bun add moo mitata --save-dev
//
// Made with ❤️ by Maysara.



// ╔════════════════════════════════════════ PACK ════════════════════════════════════════╗

    import { bench, group, run } from 'mitata';
    import { compile, keywords } from '../src';

// ╚══════════════════════════════════════════════════════════════════════════════════════╝



// ╔════════════════════════════════════════ CORE ════════════════════════════════════════╗

    // ---------------------------------------------------------------------------
    // Moo (optional)
    // ---------------------------------------------------------------------------

    let mooL: { reset(s: string): void; next(): unknown } | null = null;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const m = require('moo') as typeof import('moo');
        const kw = m.keywords({ KW: ['fn', 'return', 'if', 'else', 'while', 'for', 'let', 'const'] });
        mooL = m.compile({
            WS              : /[ \t\r]+/,
            NL              : { match: /\n/, lineBreaks: true },
            COMMENT         : /\/\/[^\n]*/,
            NUMBER          : /0|[1-9][0-9]*/,
            STRING          : { match: /"(?:\\.|[^"\\])*"/, lineBreaks: false },
            IDENT           : { match: /[a-zA-Z_$][a-zA-Z0-9_$]*/, type: kw },
            EQ3             : '===', NEQ: '!==', ARROW: '=>', GTE: '>=', LTE: '<=', AND: '&&', OR: '||',
            ASSIGN          : '=', PLUS: '+', MINUS: '-', STAR: '*', SLASH: '/', BANG: '!',
            GT              : '>', LT: '<', LPAREN: '(', RPAREN: ')', LBRACE: '{', RBRACE: '}',
            LBRACK          : '[', RBRACK: ']', SEMI: ';', COMMA: ',', DOT: '.', COLON: ':',
        });
    } catch { /* moo not installed */ }


    // ---------------------------------------------------------------------------
    // @langpkg/lexer
    // ---------------------------------------------------------------------------

    const kw = keywords({ KW: ['fn', 'return', 'if', 'else', 'while', 'for', 'let', 'const'] });
    const lexer = compile({
        WS                  : /[ \t\r]+/,
        NL                  : { match: /\n/, lineBreaks: true },
        COMMENT             : /\/\/[^\n]*/,
        NUMBER              : /0|[1-9][0-9]*/,
        STRING              : { match: /"(?:\\.|[^"\\])*"/, lineBreaks: false },
        IDENT               : { match: /[a-zA-Z_$][a-zA-Z0-9_$]*/, type: kw },
        EQ3                 : '===', NEQ: '!==', ARROW: '=>', GTE: '>=', LTE: '<=', AND: '&&', OR: '||',
        ASSIGN              : '=', PLUS: '+', MINUS: '-', STAR: '*', SLASH: '/', BANG: '!',
        GT                  : '>', LT: '<', LPAREN: '(', RPAREN: ')', LBRACE: '{', RBRACE: '}',
        LBRACK              : '[', RBRACK: ']', SEMI: ';', COMMA: ',', DOT: '.', COLON: ':',
    });


    // ---------------------------------------------------------------------------
    // Input
    // ---------------------------------------------------------------------------

    function makeInput(kb: number): string {
        const block = [
            'fn fibonacci(n: i32) -> i32 {',
            '  // base case',
            '  if n <= 1 { return n; }',
            '  return fibonacci(n - 1) + fibonacci(n - 2);',
            '}',
            'const result = fibonacci(10);',
            'let flag = result >= 100 || result == 0;',
            'const str = "hello world";',
            '',
        ].join('\n') + '\n';
        let s = '';
        while (s.length < kb * 1024) s += block;
        return s;
    }


    // ---------------------------------------------------------------------------
    // Run
    // ---------------------------------------------------------------------------

    for (const kb of [64, 256, 1024]) {
        const input = makeInput(kb);

        group(`${kb} KB`, () => {
            bench('@langpkg/lexer', () => {
                lexer.reset(input);
                // eslint-disable-next-line no-empty
                while (lexer.next() !== undefined) { }
            });

            if (mooL) {
                const l = mooL;
                bench('moo', () => {
                    l.reset(input);
                    // eslint-disable-next-line no-empty
                    while (l.next() !== undefined) { }
                });
            }
        });
    }

    await run();

// ╚══════════════════════════════════════════════════════════════════════════════════════╝
