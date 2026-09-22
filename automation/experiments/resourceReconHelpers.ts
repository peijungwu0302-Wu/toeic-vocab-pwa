export interface SanitizedResource {
  protocol: string;
  host: string | null;
  pathPattern: string | null;
  queryParameterNames: string[];
}

export function sanitizeResourceUrl(value: string | null | undefined): SanitizedResource {
  if (!value) return { protocol: 'none', host: null, pathPattern: null, queryParameterNames: [] };
  try {
    const url = new URL(value);
    return {
      protocol: url.protocol.replace(':', ''),
      host: url.hostname || null,
      pathPattern: url.pathname || '/',
      queryParameterNames: [...url.searchParams.keys()].sort(),
    };
  } catch {
    return { protocol: value.startsWith('blob:') ? 'blob' : value.startsWith('data:') ? 'data' : 'other', host: null, pathPattern: null, queryParameterNames: [] };
  }
}

export function classifyImageCandidate(naturalWidth: number, naturalHeight: number, renderedWidth: number, renderedHeight: number): 'likely original/high-resolution candidate' | 'likely displayed rendition' | 'likely thumbnail' | 'unknown' {
  if (naturalWidth <= 0 || naturalHeight <= 0) return 'unknown';
  if (renderedWidth > 0 && renderedHeight > 0 && naturalWidth < renderedWidth * 0.75) return 'likely thumbnail';
  if (renderedWidth > 0 && renderedHeight > 0 && naturalWidth > renderedWidth * 1.2) return 'likely original/high-resolution candidate';
  return 'likely displayed rendition';
}
