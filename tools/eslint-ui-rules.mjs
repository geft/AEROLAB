/** Checks text expressions without treating event payloads or CSS as UI copy. */
export function createUiRules(neutralPatterns) {
  const neutral = neutralPatterns.map(pattern => new RegExp(pattern));
  const textAttributes = new Set(['title', 'placeholder', 'alt', 'aria-label', 'aria-description', 'aria-valuetext']);
  const localeMethods = new Set(['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString']);
  const memberName = node => node?.type === 'MemberExpression' && !node.computed ? node.property.name : null;
  const isLanguage = node => node?.type === 'Identifier' && ['language', 'locale'].includes(node.name) ||
    ['language', 'locale'].includes(memberName(node));

  return {
    'no-untranslated-ui-expression': {
      meta: {
        type: 'problem',
        schema: [],
        messages: { text: 'Move user-facing text into the bilingual dictionaries and read it through useTranslation().' }
      },
      create(context) {
        function checkText(node, value) {
          const text = value.trim();
          if (text && !neutral.some(pattern => pattern.test(text))) context.report({ node, messageId: 'text' });
        }
        function checkExpression(node) {
          if (!node) return;
          if (node.type === 'Literal' && typeof node.value === 'string') checkText(node, node.value);
          else if (node.type === 'TemplateLiteral') {
            node.quasis.forEach(part => checkText(part, part.value.cooked ?? part.value.raw));
            node.expressions.forEach(checkExpression);
          } else if (node.type === 'ConditionalExpression') {
            checkExpression(node.consequent);
            checkExpression(node.alternate);
          } else if (node.type === 'LogicalExpression' || (node.type === 'BinaryExpression' && node.operator === '+')) {
            if (node.operator !== '&&') checkExpression(node.left);
            checkExpression(node.right);
          } else if (['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'ChainExpression'].includes(node.type)) {
            checkExpression(node.expression);
          } else if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'format') {
            checkExpression(node.arguments[0]);
          }
        }
        return {
          JSXExpressionContainer(node) {
            if (node.parent.type === 'JSXElement' || node.parent.type === 'JSXFragment') checkExpression(node.expression);
          },
          JSXAttribute(node) {
            if (!textAttributes.has(node.name.name)) return;
            checkExpression(node.value?.type === 'JSXExpressionContainer' ? node.value.expression : node.value);
          }
        };
      }
    },
    'no-inline-language-copy': {
      meta: {
        type: 'problem',
        schema: [],
        messages: { language: 'Use bilingual dictionary keys instead of switching UI copy inline by language or locale.' }
      },
      create(context) {
        function testsLanguage(node) {
          if (!node) return false;
          if (node.type === 'BinaryExpression' && ['===', '!==', '==', '!='].includes(node.operator)) {
            return isLanguage(node.left) || isLanguage(node.right);
          }
          if (node.type === 'LogicalExpression') return testsLanguage(node.left) || testsLanguage(node.right);
          if (node.type === 'UnaryExpression') return testsLanguage(node.argument);
          return false;
        }
        return {
          ConditionalExpression(node) {
            if (testsLanguage(node.test)) {
              const structural = branch => ['JSXElement', 'JSXFragment'].includes(branch.type) ||
                branch.type === 'Literal' && branch.value === null;
              if (structural(node.consequent) && structural(node.alternate)) return;
              let attribute = node.parent;
              while (attribute && attribute.type !== 'JSXAttribute' && attribute.type !== 'JSXElement') attribute = attribute.parent;
              if (attribute?.type === 'JSXAttribute' && !textAttributes.has(attribute.name.name)) return;
              context.report({ node, messageId: 'language' });
            }
          }
        };
      }
    },
    'no-hardcoded-date-locale': {
      meta: {
        type: 'problem',
        schema: [],
        messages: { locale: 'Format dates through useTranslation().formatDate; locale identifiers belong in LOCALES.' }
      },
      create(context) {
        function hasLiteralLocale(node) {
          if (!node) return false;
          if (node.type === 'Literal') return typeof node.value === 'string';
          if (node.type === 'TemplateLiteral') return node.quasis.some(part => part.value.raw.trim());
          if (node.type === 'ArrayExpression') return node.elements.some(hasLiteralLocale);
          if (node.type === 'ConditionalExpression') return hasLiteralLocale(node.consequent) || hasLiteralLocale(node.alternate);
          return false;
        }
        function check(node) {
          const name = memberName(node.callee);
          const intlDate = name === 'DateTimeFormat' && node.callee.object.type === 'Identifier' && node.callee.object.name === 'Intl';
          if (!intlDate && !localeMethods.has(name)) return;
          const locale = node.arguments[0];
          if (hasLiteralLocale(locale)) {
            context.report({ node: locale, messageId: 'locale' });
          }
        }
        return { CallExpression: check, NewExpression: check };
      }
    }
  };
}
