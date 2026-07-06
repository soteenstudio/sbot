import tsParser from '@typescript-eslint/parser';
import headers from 'eslint-plugin-headers';
const customNoCommentRule = {
  meta: {
    type: 'layout',
    docs: { description: 'Remove comments & give breath after header' },
    fixable: 'code',
  },
  create(context) {
    const sourceCode = context.sourceCode;
    return {
      Program(node) {
        const comments = sourceCode.getAllComments();
        comments.forEach((comment) => {
          if (!(comment.type === 'Block' && comment.value.startsWith('*'))) {
            context.report({
              node: comment,
              message: 'Comments are prohibited!',
              fix(fixer) {
                return fixer.remove(comment);
              },
            });
          }
        });
        const firstComment = sourceCode.getAllComments()[0];
        if (firstComment && firstComment.value.includes('Copyright 2026')) {
          const tokenAfter = sourceCode.getTokenAfter(firstComment);
          const range = [firstComment.range[1], tokenAfter.range[0]];
          const textBetween = sourceCode
            .getText()
            .substring(range[0], range[1]);

          if (!textBetween.includes('\n\n')) {
            context.report({
              node: firstComment,
              message: 'Need a blank line after the header',
              fix(fixer) {
                return fixer.insertTextAfter(firstComment, '\n');
              },
            });
          }
        }
      },
    };
  },
};
export default [
  {
    files: ['src/**/*.{js,ts}', 'tests/**/*.{js,ts}', 'scripts/**/*.{js,ts}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      cleaner: {
        rules: {
          'no-comment': customNoCommentRule,
        },
      },
      headers,
    },
    rules: {
      'cleaner/no-comment': 'error',
      'no-multiple-empty-lines': [
        'error',
        {
          max: 1,
          maxEOF: 1,
          maxBOF: 0,
        },
      ],
      'headers/header-format': [
        'error',
        {
          source: 'string',
          content: `Copyright 2026 SoTeen Studio\n\nLicensed under the Apache License, Version 2.0 (the "License");\nyou may not use this file except in compliance with the License.\nYou may obtain a copy of the License at\n\n    http://www.apache.org/licenses/LICENSE-2.0`,
        },
      ],
    },
  },
];
