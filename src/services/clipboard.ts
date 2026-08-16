export async function copyText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error("当前浏览器无法访问剪贴板，请在 Chrome 扩展中重试。");
  }
  await navigator.clipboard.writeText(text);
}

