/**
 * Reads CSV text into rows of cells. Handles quoted cells, doubled quotes, line breaks inside quotes,
 * Windows and Unix line endings and the invisible marker Excel puts at the start of a file.
 * Blank lines are skipped.
 */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  const endCell = (): void => {
    row.push(cell);
    cell = '';
  };
  const endRow = (): void => {
    endCell();
    if (row.some((value) => value.trim() !== '')) rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (inQuotes) {
      if (char === '"') {
        if (text.charAt(index + 1) === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === '') {
      inQuotes = true;
    } else if (char === ',') {
      endCell();
    } else if (char === '\n') {
      endRow();
    } else if (char === '\r') {
      if (text.charAt(index + 1) === '\n') index += 1;
      endRow();
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}

/** Lower-case letters and digits only, so "Full Name", "full_name" and "FULLNAME" match. */
export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}
