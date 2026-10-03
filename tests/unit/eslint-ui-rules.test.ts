import { beforeAll, describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

const eslint = new ESLint();
async function messages(code: string) {
  const [result] = await eslint.lintText(code, { filePath: 'src/frontend/components/LintFixture.tsx' });
  return result.messages;
}

describe('UI lint guards', () => {
  beforeAll(async () => {
    await eslint.calculateConfigForFile('src/frontend/components/LintFixture.tsx');
  }, 20_000);

  it.each([
    ['raw JSX text', 'export const Demo = () => <div>Save changes</div>;', 'i18next/no-literal-string'],
    ['expression text', "export const Demo = () => <div>{'Save changes'}</div>;", 'aerolab-ui/no-untranslated-ui-expression'],
    ['template text', 'export const Demo = ({ count }) => <div>{`Loaded ${count} sessions`}</div>;', 'aerolab-ui/no-untranslated-ui-expression'],
    ['fallback copy', "export const Demo = ({ t }) => <div>{t.common.save || 'Save changes'}</div>;", 'aerolab-ui/no-untranslated-ui-expression'],
    ['concatenated text', "export const Demo = ({ count }) => <div>{'Sessions: ' + count}</div>;", 'aerolab-ui/no-untranslated-ui-expression'],
    ['conditional copy', "export const Demo = ({ busy }) => <div>{busy ? 'Loading' : 'Ready'}</div>;", 'aerolab-ui/no-untranslated-ui-expression'],
    ['tooltip', 'export const Demo = () => <button title="Save changes" />;', 'aerolab-ui/no-untranslated-ui-expression'],
    ['accessible label', 'export const Demo = () => <button aria-label="Save changes" />;', 'aerolab-ui/no-untranslated-ui-expression'],
    ['placeholder', 'export const Demo = () => <input placeholder="Enter a name" />;', 'aerolab-ui/no-untranslated-ui-expression'],
    ['literal format template', "export const Demo = ({ format, count }) => <div>{format('Loaded {count} sessions', { count })}</div>;", 'aerolab-ui/no-untranslated-ui-expression'],
    ['locale switch', "export const Demo = ({ language }) => <div>{language === 'zh' ? '保存' : 'Save'}</div>;", 'aerolab-ui/no-inline-language-copy'],
    ['dictionary switch', "export const Demo = ({ language, zh, en }) => <div>{language === 'zh' ? zh.save : en.save}</div>;", 'aerolab-ui/no-inline-language-copy'],
    ['member locale switch', "export const Demo = ({ state, t }) => <div>{state.locale === 'zh-CN' ? t.zh : t.en}</div>;", 'aerolab-ui/no-inline-language-copy'],
    ['hardcoded date locale', "export const label = (date: Date) => date.toLocaleDateString('en-US');", 'aerolab-ui/no-hardcoded-date-locale'],
    ['hardcoded Intl locale', "export const formatter = new Intl.DateTimeFormat('zh-CN');", 'aerolab-ui/no-hardcoded-date-locale'],
    ['locale fallback list', "export const formatter = new Intl.DateTimeFormat(['zh-CN', 'en-US']);", 'aerolab-ui/no-hardcoded-date-locale'],
    ['conditional date locale', "export const label = (date: Date, chinese: boolean) => date.toLocaleDateString(chinese ? 'zh-CN' : 'en-US');", 'aerolab-ui/no-hardcoded-date-locale'],
    ['hardcoded metric', 'export const Demo = () => <div>145 bpm</div>;', 'aerolab/no-hardcoded-metric-text'],
    ['unused declaration', 'export const label = 1; const unused = 2;', 'unused-imports/no-unused-vars'],
    ['explicit any', 'export const label: any = 1;', '@typescript-eslint/no-explicit-any']
  ])('rejects %s as an error', async (_name, code, ruleId) => {
    expect(await messages(code)).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId, severity: 2 })]));
  });

  it.each([
    ['dictionary text and attributes', 'export const Demo = ({ t }) => <button title={t.common.save}>{t.common.save}</button>;'],
    ['formatted and pluralized text', 'export const Demo = ({ t, format, plural, count }) => <div>{format(t.browse.sessions, { count })}{plural(count, t.browse.runs)}</div>;'],
    ['dynamic metrics and neutral units', 'export const Demo = ({ pace, hr }) => <div>{pace} /km {`${hr} bpm`}</div>;'],
    ['CSS and language selection classes', "export const Demo = ({ language, code }) => <div className={`menu ${language === code ? 'active' : ''}`} style={{ width: '80%' }} />;"],
    ['language selection icons', 'export const Demo = ({ language, code }) => <div>{language === code ? <svg /> : null}</div>;'],
    ['event payloads', "export const Demo = ({ select }) => <button onClick={() => select('month')} />;"],
    ['data comparisons', "export const Demo = ({ kind, t }) => <div>{kind === 'easy_base' && t.common.save}</div>;"],
    ['date hook', "export const label = (formatDate, date) => formatDate(date, { month: 'short' });"],
    ['dynamic Intl locale', 'export const formatter = (locale: string) => new Intl.DateTimeFormat(locale);'],
    ['dynamic locale list', 'export const formatter = (locale: string) => new Intl.DateTimeFormat([locale]);'],
    ['type assertions around dictionary text', 'export const Demo = ({ t }) => <div>{t.common.save as string}</div>;']
  ])('allows %s', async (_name, code) => {
    expect(await messages(code)).toEqual([]);
  });
});
