export type Redline = {
  text_snippet: string;
  playbook_clause_reference: string;
  suggested_fix: string;
};

export type PlaybookClause = {
  clause: string;
  clause_definition?: string;
  red_flag?: string;
  example_ideal_clause?: string;
  example_fallback_clause?: string;
  is_required?: boolean;
};

export type RedlineResponse = {
  redlines: Redline[];
  dropped: { reason: string; entry: Partial<Redline> }[];
  documentLineCount: number;
};
