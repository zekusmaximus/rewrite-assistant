/* Minimal ambient typing for compromise NLP to satisfy strict TS */
declare module 'compromise' {
  type NLPDoc = {
    match?: (...args: any[]) => any;
    people?: (...args: any[]) => any;
    json?: (...args: any[]) => any;
    out?: (...args: any[]) => any;
    [k: string]: any;
  };

  const nlp: (text?: string) => NLPDoc;
  export default nlp;
}