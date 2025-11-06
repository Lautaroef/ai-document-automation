declare module 'html-to-docx' {
  function HTMLtoDOCX(
    html: string,
    headerHTML?: string | null,
    options?: {
      table?: { row?: { cantSplit?: boolean } };
      footer?: boolean;
      pageNumber?: boolean;
    }
  ): Promise<Buffer>;

  export default HTMLtoDOCX;
}
