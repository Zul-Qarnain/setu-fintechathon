export interface SessionDoc { id: string; filename: string; status: string }
const KEY = "setu.sessionDocs";
export function listSessionDocs(): SessionDoc[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(window.sessionStorage.getItem(KEY) ?? "[]") as SessionDoc[]; } catch { return []; }
}
function save(d: SessionDoc[]) { window.sessionStorage.setItem(KEY, JSON.stringify(d)); }
export function addSessionDoc(d: SessionDoc) { save([d, ...listSessionDocs().filter((x) => x.id !== d.id)].slice(0, 20)); }
export function updateSessionDoc(id: string, status: string) { save(listSessionDocs().map((x) => (x.id === id ? { ...x, status } : x))); }
