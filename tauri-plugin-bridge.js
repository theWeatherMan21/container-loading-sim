const TauriBridge = (() => {
  const isTauri = typeof window !== 'undefined' && !!(window.__TAURI__ && window.__TAURI__.core);

  // 选择 Excel 并读取内容（一步完成，Rust 侧不暴露任意路径读取）
  async function pickExcelFileRead() {
    if (!isTauri) return null;
    return window.__TAURI__.core.invoke('pick_excel_file_read');
  }

  async function savePdfFile(defaultName, uint8Array) {
    if (!isTauri) return null;
    const arr = Array.from(uint8Array);
    return window.__TAURI__.core.invoke('save_pdf_file', { defaultName, data: arr });
  }

  return { isTauri, pickExcelFileRead, savePdfFile };
})();

if (typeof window !== 'undefined') {
  window.TauriBridge = TauriBridge;
}
