import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SalesPdfViewer from '../components/sales-materials/SalesPdfViewer';
const pdf=vi.hoisted(()=>({getDocument:vi.fn(),getPage:vi.fn(),destroy:vi.fn(),cancel:vi.fn()}));
vi.mock('pdfjs-dist',()=>({version:'test-version',GlobalWorkerOptions:{},getDocument:pdf.getDocument}));
beforeEach(()=>{
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
  pdf.getPage.mockResolvedValue({getViewport:({scale}:{scale:number})=>({width:600*scale,height:800*scale}),render:()=>({promise:Promise.resolve(),cancel:pdf.cancel})});
  pdf.getDocument.mockReturnValue({promise:Promise.resolve({numPages:33,getPage:pdf.getPage}),destroy:pdf.destroy});
});
describe('PDF原件阅读',()=>{
  it('renders the referenced policy page, supports adjacent pages and releases the document',async()=>{
    const view=render(<SalesPdfViewer title="英皇政策" url="/private-original#page=31"/>);
    await waitFor(()=>expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(pdf.getDocument).toHaveBeenCalledWith(expect.objectContaining({url:'/private-original',cMapUrl:'/vendor/pdfjs/test-version/cmaps/'}));
    expect(pdf.getPage).toHaveBeenCalledWith(31);expect(screen.getByLabelText('PDF页码')).toHaveValue('31');
    fireEvent.click(screen.getByRole('button',{name:'下一页'}));
    await waitFor(()=>expect(pdf.getPage).toHaveBeenCalledWith(32));
    view.unmount();expect(pdf.destroy).toHaveBeenCalled();
  });
  it('provides a real retry after loading fails',async()=>{
    pdf.getDocument.mockReturnValueOnce({promise:Promise.reject(new Error('unavailable')),destroy:pdf.destroy});
    render(<SalesPdfViewer title="业主原件" url="/private-original"/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('PDF 原件加载失败');
    fireEvent.click(screen.getByRole('button',{name:'重试'}));
    await waitFor(()=>expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(pdf.getDocument).toHaveBeenCalledTimes(2);expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
