import {fireEvent,render,screen} from '@testing-library/react';
import{afterEach,beforeEach,describe,expect,it,vi}from'vitest';
import FloatingBuildingList from '../components/FloatingBuildingList';
import{MapSalesMaterialsBridge}from'../MapSalesMaterialsBridge';
vi.mock('next/dynamic',()=>({default:()=>function Panel({buildingId,buildingName,onClose}:{buildingId:string;buildingName:string;onClose:()=>void}){return <div role="dialog" aria-modal="true" aria-label={buildingName} data-building-id={buildingId} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();onClose();}}}><button onClick={onClose}>关闭资料</button></div>;}}));
vi.mock('../components/BuildingBasicCard',()=>({BuildingBasicCard:({building,onClick}:{building:{name:string};onClick:()=>void})=><button onClick={onClick}>{building.name}详情卡</button>}));
beforeEach(()=>{vi.stubGlobal('IntersectionObserver',class{observe(){}disconnect(){}});});
afterEach(()=>{vi.unstubAllGlobals();});
describe('project-list materials entry',()=>{
 it('opens scoped materials directly from both list views without invoking the map popup',()=>{
  const select=vi.fn();render(<><FloatingBuildingList buildings={[{id:'master-a',name:'甲楼',metrics:[]}]} onClose={vi.fn()} onBuildingClick={select}/><MapSalesMaterialsBridge/></>);
  fireEvent.click(screen.getByRole('button',{name:'查看甲楼资料与佣金'}));expect(screen.getByRole('dialog',{name:'甲楼'})).toHaveAttribute('data-building-id','master-a');expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('关闭资料'));fireEvent.click(screen.getByRole('button',{name:'详情'}));
  fireEvent.click(screen.getByRole('button',{name:'查看甲楼资料与佣金'}));expect(screen.getByRole('dialog',{name:'甲楼'})).toBeInTheDocument();expect(select).not.toHaveBeenCalled();
 });
 it('uses linked building IDs for future supply and leaves unlinked projects without a misleading entry',()=>{
  render(<><FloatingBuildingList buildings={[{id:'future-row',building_id:'master-future',_dataType:'future',name:'已关联',metrics:[]},{id:'unlinked',_dataType:'future',name:'未关联',metrics:[]}]} onClose={vi.fn()}/><MapSalesMaterialsBridge/></>);
  expect(screen.queryByRole('button',{name:'查看未关联资料与佣金'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'查看已关联资料与佣金'}));expect(screen.getByRole('dialog')).toHaveAttribute('data-building-id','master-future');
 });
});

it('closes only the materials layer on Escape and retains the project list',()=>{
 const closeList=vi.fn();render(<><FloatingBuildingList buildings={[{id:'master-a',name:'甲楼',metrics:[]}]} onClose={closeList}/><MapSalesMaterialsBridge/></>);
 fireEvent.click(screen.getByRole('button',{name:'查看甲楼资料与佣金'}));
 fireEvent.keyDown(screen.getByText('关闭资料'),{key:'Escape'});expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(closeList).not.toHaveBeenCalled();
 fireEvent.keyDown(screen.getByRole('button',{name:'查看甲楼资料与佣金'}),{key:'Escape'});expect(closeList).toHaveBeenCalledOnce();
});
