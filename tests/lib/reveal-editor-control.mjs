// Follow visible disclosure controls before interacting with an editor tool.
// No force clicks, app-state writes, or implementation-owned flags.
export async function revealEditorControl(page, selector) {
  const target=page.locator(selector).first();
  await target.waitFor({state:'attached'});
  for(let i=0;i<6;i++){
    const handle=await target.evaluateHandle(el=>{const all=[];for(let p=el.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.open)all.push(p);return all.at(-1)?.querySelector(':scope > summary')||null;});
    const summary=handle.asElement();
    if(!summary){await handle.dispose();return;}
    await summary.click();await handle.dispose();
  }
  throw new Error('Editor tool remains behind nested disclosures: '+selector);
}
