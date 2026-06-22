const TauriBridge = (() => {
  const isTauri = typeof window !== 'undefined' && !!(window.__TAURI__ && window.__TAURI__.core);

  async function pickExcelFile() {
    if (!isTauri) return null;
    return window.__TAURI__.core.invoke('pick_excel_file');
  }

  async function readFileBytes(path) {
    if (!isTauri) return null;
    return window.__TAURI__.core.invoke('read_file_bytes', { path });
  }

  async function savePdfFile(defaultName, uint8Array) {
    if (!isTauri) return null;
    const arr = Array.from(uint8Array);
    return window.__TAURI__.core.invoke('save_pdf_file', { defaultName, data: arr });
  }

  return { isTauri, pickExcelFile, readFileBytes, savePdfFile };
})();

if (typeof window !== 'undefined') {
  window.TauriBridge = TauriBridge;
}
