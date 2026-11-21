/** Trusted bundled report only. Observe explicit chapter / view selections, never hover or scroll. */
export function instrumentResearchHtml(html:string):string {
  const script=`<script>
  (()=>{
    const keys=['go','timeView','leed','stockView','worldMode','project','rail'];
    document.addEventListener('click',event=>{
      const node=event.target.closest('[data-go],[data-time-view],[data-leed],[data-stock-view],[data-world-mode],[data-project],[data-rail]');
      if(!node)return;
      const key=keys.find(key=>node.dataset[key]!==undefined);
      const section=node.dataset.go || node.closest('section[id],main[id]')?.id || 'report';
      const control=key==='go'?'chapter':key+'_'+node.dataset[key];
      if(/^[a-zA-Z0-9_-]{1,64}$/.test(section)&&/^[a-zA-Z0-9_-]{1,64}$/.test(control))
        parent.postMessage({type:'research-reading',section,control},'*');
    });
  })();
  </script>`;
  return html.replace('</body>',script+'</body>');
}
