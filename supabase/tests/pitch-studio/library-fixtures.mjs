import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import sharp from 'sharp';
import XLSX from 'xlsx';
import { PDFDocument, StandardFonts } from 'pdf-lib';
export const NOTE_SECRET='NOTE_PRIVATE_SENTINEL_927',HIDDEN_SECRET='HIDDEN_PRIVATE_SENTINEL_834';
export async function materialFixtures(){
 const image=await sharp({create:{width:800,height:450,channels:3,background:'#e5e8ec'}}).png().toBuffer(),ppt=new PptxGenJS();ppt.layout='LAYOUT_WIDE';
 const titles=['隔离测试｜公司介绍','隔离测试｜团队介绍','隔离测试｜代表案例','隔离测试｜房地产市场研究'];
 for(const [i,title] of titles.entries()){const slide=ppt.addSlide();slide.addText(title,{x:.6,y:.4,w:12,h:.6,fontSize:28,fontFace:'Arial'});slide.addText(['公司信息仅为验证用，无真实客户。','团队成员 A / 测试顾问，全部虚构。','案例 A：需求、服务、成果均为测试数据。','统计期间 2025 年；单位：元／平方米／月。'][i],{x:.6,y:1.3,w:11.8,h:.8,fontSize:18});if(i===0)slide.addImage({data:'image/png;base64,'+image.toString('base64'),x:.6,y:2.5,w:6,h:3.375});if(i===1)slide.addText(HIDDEN_SECRET,{x:8,y:3,w:3,h:1});if(i===2)slide.addTable([['项目','面积（平方米）'],['测试楼 A',1234],['测试楼 B',0]],{x:.6,y:2.5,w:8,h:2,fontSize:18});if(i===3)slide.addChart(ppt.ChartType.line,[{name:'租金（元／平方米／月）',labels:['2024','2025'],values:[100,95]}],{x:.6,y:2.5,w:8,h:3.8,showTitle:false});slide.addNotes(NOTE_SECRET);}
 const zip=await JSZip.loadAsync(await ppt.write({outputType:'nodebuffer'}));let xml=await zip.file('ppt/slides/slide2.xml').async('string');xml=xml.replace(/(<p:sp>[\s\S]*?<\/p:sp>)/g,sp=>sp.includes(HIDDEN_SECRET)?sp.replace('<p:cNvPr ','<p:cNvPr hidden="1" '):sp);zip.file('ppt/slides/slide2.xml',xml);
 const pptx=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
 const reordered=await JSZip.loadAsync(pptx),presentation=await reordered.file('ppt/presentation.xml').async('string');const ids=presentation.match(/<p:sldId\b[^>]*\/>/g);reordered.file('ppt/presentation.xml',presentation.replace(ids.join(''),[ids[2],ids[0],ids[1],ids[3]].join('')));
 const word=new JSZip();word.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');word.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>隔离测试公司介绍</w:t></w:r></w:p><w:p><w:r><w:t>原始段落甲</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>名称</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>测试值</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第二节</w:t></w:r></w:p></w:body></w:document>');
 const workbook=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([['指标','数值'],['零值',0],['公式',2],['缺失',null]]);sheet.B3={t:'n',v:2,f:'1+1'};XLSX.utils.book_append_sheet(workbook,sheet,'历史数据');
 const pdf=await PDFDocument.create(),page=pdf.addPage([600,400]),font=await pdf.embedFont(StandardFonts.Helvetica);page.drawText('Synthetic company profile only',{x:40,y:300,size:24,font});pdf.addPage([600,400]);
 return {pptx,reordered:await reordered.generateAsync({type:'uint8array'}),image:new Uint8Array(image),docx:await word.generateAsync({type:'uint8array'}),xlsx:new Uint8Array(XLSX.write(workbook,{type:'buffer',bookType:'xlsx'})),pdf:await pdf.save()};
}
