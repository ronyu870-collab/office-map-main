// Independent observation: actual visible panel edges and the SDK's public pixel
// projection, without importing the application's camera or padding formulas.
export function visibleProjectProjection({coords,check=false,tolerance=5}) {
  const map=window.__workspaceMap,host=document.querySelector('#map-container');
  if(!map?.lngLatToContainer||!host)return check?false:null;
  const box=host.getBoundingClientRect(),layout=host.closest('.map-workspace-layout');
  let left=box.left,right=box.right,bottom=box.bottom;const top=box.top;
  for(const pane of layout?.querySelectorAll(':scope > aside[data-open]:not([inert])')??[]){
    const rect=pane.getBoundingClientRect();
    if(layout.hasAttribute('data-compact'))bottom=Math.min(bottom,rect.top);
    else if(pane.classList.contains('map-workspace-left'))left=Math.max(left,rect.right);
    else right=Math.min(right,rect.left);
  }
  const point=map.lngLatToContainer(coords),x=box.left+(point.getX?.()??point.x),y=box.top+(point.getY?.()??point.y);
  const center=[(left+right)/2,(top+bottom)/2];
  const centered=Math.abs(x-center[0])<=tolerance&&Math.abs(y-center[1])<=tolerance;
  const result={point:[x,y],canvas:{left:box.left,top:box.top,width:box.width,height:box.height},visible:{left,right,top,bottom,width:right-left,height:bottom-top},center,centered};
  return check?centered:result;
}

export async function waitForVisibleProject(page,coords,timeout=10000){
  await page.waitForFunction(visibleProjectProjection,{coords,check:true},{timeout});
  return page.evaluate(visibleProjectProjection,{coords});
}
