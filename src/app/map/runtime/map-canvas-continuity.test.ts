import { afterEach, expect, it, vi } from 'vitest';
import { observeMapCanvas, projectCamera } from './observeMapCanvas';
import { readMapVisibleArea, visibleMapRect } from './mapFocusViewport';
import { mercatorPoint } from './mapExtent';

afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals();});

function fixture() {
  const root=document.createElement('div');root.className='map-workspace-layout';
  const main=document.createElement('main'),host=document.createElement('div'),right=document.createElement('aside');
  right.dataset.mapFocusRight='';right.dataset.open='';
  main.append(host);root.append(main,right);document.body.append(root);
  let rightWidth=400;
  root.getBoundingClientRect=host.getBoundingClientRect=()=>new DOMRect(0,0,1200,600);
  right.getBoundingClientRect=()=>new DOMRect(1200-rightWidth,0,rightWidth,600);
  return {root,main,host,right,setWidth:(width:number)=>{rightWidth=width;}};
}

it('reserves the final owned pane even during its transparent entry and keeps small phone map space',()=>{
  const {host,right}=fixture();right.style.opacity='0';
  const {rect,reserved}=readMapVisibleArea(host);
  expect(visibleMapRect(rect,reserved).right).toBeLessThan(800);
  const phone=visibleMapRect(new DOMRect(0,0,390,500),{bottom:new DOMRect(0,100,390,400)});
  expect(phone.bottom).toBeLessThan(100);
  expect(phone.height).toBeGreaterThan(0);
});

it('places a project at the visible map center with one camera instead of centering under the pane',()=>{
  const target:[number,number]=[116.4,39.9];
  const canvas=new DOMRect(0,0,1200,600),visible=new DOMRect(20,20,760,560);
  const camera=projectCamera(target,null,1200,600,14,{canvas,visible});
  const [tx,ty]=mercatorPoint(...target),[cx,cy]=mercatorPoint(...camera.center),scale=256*2**camera.zoom;
  expect(600+(tx-cx)*scale).toBeCloseTo(400,5);
  expect(300+(ty-cy)*scale).toBeCloseTo(300,5);
});

it('reprojects owned project focus when pane geometry changes without resizing the SDK or reclaiming a gesture',()=>{
  let resize=()=>{};const frames=new Map<number,FrameRequestCallback>();let next=0;
  const flush=()=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(callback=>callback(0));};
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.set(++next,callback);return next;});
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
  vi.stubGlobal('ResizeObserver',class{constructor(callback:()=>void){resize=callback;}observe(){}disconnect(){}});
  vi.stubGlobal('matchMedia',()=>({matches:false}));
  const {host,setWidth}=fixture();
  const map={resize:vi.fn(),getZoom:()=>14,getCenter:()=>[116.4,39.9],setZoomAndCenter:vi.fn()};
  const coordinator=observeMapCanvas(host,map);
  coordinator.focus({center:[116.4,39.9]});flush();
  const first=map.setZoomAndCenter.mock.calls[0][1];
  setWidth(500);resize();flush();
  expect(map.resize).toHaveBeenCalledOnce();
  expect(map.setZoomAndCenter).toHaveBeenCalledTimes(2);
  expect(map.setZoomAndCenter.mock.calls[1][1]).not.toEqual(first);
  host.dispatchEvent(new Event('pointerdown'));const count=map.setZoomAndCenter.mock.calls.length;
  setWidth(550);resize();flush();expect(map.setZoomAndCenter).toHaveBeenCalledTimes(count);
  coordinator();
});

it('holds the latest target until owned reading geometry is measured and visible',()=>{
  let resize=()=>{};const frames:FrameRequestCallback[]=[];
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.push(callback);return frames.length;});
  vi.stubGlobal('cancelAnimationFrame',vi.fn());
  vi.stubGlobal('ResizeObserver',class{constructor(callback:()=>void){resize=callback;}observe(){}disconnect(){}});
  vi.stubGlobal('matchMedia',()=>({matches:false}));
  const flush=()=>frames.splice(0).forEach(callback=>callback(0));
  const {host,root,main}=fixture();root.dataset.mapLayoutReady='false';
  const map={resize:vi.fn(),setZoomAndCenter:vi.fn()};const coordinator=observeMapCanvas(host,map);
  coordinator.focus({center:[116.3,39.9]});coordinator.focus({center:[116.4,39.9]});flush();
  expect(map.setZoomAndCenter).not.toHaveBeenCalled();
  root.dataset.mapLayoutReady='true';main.setAttribute('inert','');resize();flush();
  expect(map.setZoomAndCenter).not.toHaveBeenCalled();
  main.removeAttribute('inert');resize();flush();
  expect(map.setZoomAndCenter).toHaveBeenCalledOnce();
  const camera=map.setZoomAndCenter.mock.calls[0][1];expect(camera[0]).toBeGreaterThan(116.4);
  coordinator();
});


it('claims a pending region without pretending an empty placeholder is a running camera',()=>{
  const frames:FrameRequestCallback[]=[];
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.push(callback);return frames.length;});
  vi.stubGlobal('cancelAnimationFrame',vi.fn());vi.stubGlobal('matchMedia',()=>({matches:false}));
  const {host}=fixture();
  const map={getCenter:()=>[116.4,39.9],getZoom:()=>14,setZoomAndCenter:vi.fn()};
  const coordinator=observeMapCanvas(host,map);
  coordinator.claim('CBD');frames.splice(0).forEach(callback=>callback(0));
  coordinator.cancel();
  expect(map.setZoomAndCenter).not.toHaveBeenCalled();
  const fit=vi.fn();coordinator.claim('CBD');coordinator.update('CBD',{fit,extentKey:'final'});
  frames.splice(0).forEach(callback=>callback(0));expect(fit).toHaveBeenCalledOnce();
  coordinator();
});


it('does not stop a camera when the current extent had no locatable project to move to',()=>{
  const frames:FrameRequestCallback[]=[];
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.push(callback);return frames.length;});
  vi.stubGlobal('cancelAnimationFrame',vi.fn());vi.stubGlobal('matchMedia',()=>({matches:false}));
  const {host}=fixture();const map={getCenter:()=>[116.4,39.9],getZoom:()=>14,setZoomAndCenter:vi.fn()};
  const coordinator=observeMapCanvas(host,map);coordinator.focus({fit:()=>false});
  frames.splice(0).forEach(callback=>callback(0));coordinator.cancel();
  expect(map.setZoomAndCenter).not.toHaveBeenCalled();coordinator();
});
