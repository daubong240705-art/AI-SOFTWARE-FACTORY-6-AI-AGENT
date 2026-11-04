// Interaction helper shared by Electron acceptance scripts. No React internals.
async function selectValue(win, label, value) {
  const js = (source) => win.webContents.executeJavaScript(source, true);
  await js(
    `Array.from(document.querySelectorAll('[role="combobox"]')).find(el=>el.getAttribute('aria-label')===${JSON.stringify(label)}).click()`,
  );
  for (let attempt = 0; attempt < 100; attempt++) {
    const ready = await js(
      `(()=>{const trigger=Array.from(document.querySelectorAll('[role="combobox"]')).find(el=>el.getAttribute('aria-label')===${JSON.stringify(label)});const menu=document.getElementById(trigger.getAttribute('aria-controls'));if(!menu?.matches(':popover-open'))return false;const option=Array.from(menu.querySelectorAll('[role="option"]')).find(el=>el.dataset.value===${JSON.stringify(String(value))});if(!option)throw new Error('Missing dropdown option');option.click();return true;})()`,
    );
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`Dropdown did not open: ${label}`);
}
module.exports = { selectValue };
