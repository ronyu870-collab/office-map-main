import { useRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useQueryWorkspace } from '../useQueryWorkspace';

const observers: { callback: ResizeObserverCallback; observer: ResizeObserver; disconnected: boolean }[]=[];
beforeEach(()=>{
 observers.length=0;
 vi.stubGlobal('ResizeObserver',class {
  entry:{ callback: ResizeObserverCallback; observer: ResizeObserver; disconnected: boolean };
  constructor(callback:ResizeObserverCallback){this.entry={callback,observer:this as unknown as ResizeObserver,disconnected:false};observers.push(this.entry);}
  observe(){} unobserve(){} disconnect(){this.entry.disconnected=true;}
 });
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function Harness(){
 const composing=useRef(false),workspace=useQueryWorkspace(composing);
 return <div ref={workspace.anchor}><section ref={workspace.surface}>
   <button ref={workspace.toggle} onClick={workspace.expand}>展开</button>
   <div ref={workspace.scroller} data-testid="scrollport" style={{overflowY:'auto'}}><div data-testid="reading">
     <button>上一控件</button><button>复制结论</button>
   </div></div>
 </section></div>;
}
function setup(){
 const view=render(<Harness/>);fireEvent.click(screen.getByText('展开'));
 const scroller=screen.getByTestId('scrollport'),target=screen.getByText('复制结论');
 let position=140;
 Object.defineProperties(scroller,{clientHeight:{configurable:true,value:100},scrollHeight:{configurable:true,value:2000}});
 scroller.getBoundingClientRect=()=>({top:0,bottom:100,left:0,right:300,width:300,height:100,x:0,y:0,toJSON(){}});
 target.getBoundingClientRect=()=>({top:position-scroller.scrollTop,bottom:position-scroller.scrollTop+20,left:0,right:100,width:100,height:20,x:0,y:position-scroller.scrollTop,toJSON(){}});
 screen.getByText('上一控件').focus();fireEvent.keyDown(document.activeElement!,{key:'Tab'});
 expect(target).toHaveFocus();expect(scroller.scrollTop).toBe(60);
 return {...view,scroller,target,shift:()=>{position+=500;},mutate:()=>{const reading=screen.getByTestId('reading');reading.insertBefore(document.createTextNode('后续Markdown内容'),reading.firstChild);}};
}
it('keeps the keyboard target visible when delayed content is inserted above it',async()=>{
 const {scroller,target,shift,mutate}=setup();shift();act(mutate);
 await waitFor(()=>expect(target.getBoundingClientRect().bottom).toBeLessThanOrEqual(100));expect(scroller.scrollTop).toBe(560);
});
it('keeps the keyboard target visible after a later size change and releases observers on unmount',async()=>{
 const {scroller,target,shift,unmount}=setup();shift();
 act(()=>observers.forEach(({callback,observer})=>callback([],observer)));
 expect(target.getBoundingClientRect().bottom).toBeLessThanOrEqual(100);expect(scroller.scrollTop).toBe(560);
 unmount();expect(observers.every(entry=>entry.disconnected)).toBe(true);
});
it.each(['wheel','pointerdown','keydown'])('lets a later %s reading action take over instead of following the old focused control',async type=>{
 const {scroller,shift,mutate}=setup();
 if(type==='wheel')fireEvent.wheel(scroller);else if(type==='pointerdown')fireEvent.pointerDown(scroller);else fireEvent.keyDown(scroller,{key:'PageUp'});
 scroller.scrollTop=0;shift();await act(async()=>{mutate();await Promise.resolve();});
 expect(scroller.scrollTop).toBe(0);
});
