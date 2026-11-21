# 图表导出字体

Noto Sans SC Regular（简体中文完整区域字库），SIL Open Font License 1.1；原许可见 LICENSE。

来源：https://github.com/notofonts/noto-cjk/blob/main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf

SHA-256：`faa6c9df652116dde789d351359f3d7e5d2285a2b2a1f04a2d7244df706d5ea9`。此文件只进入图表服务端导出运行包，不进入地图或普通网页首屏。随包字体保证 PNG 在无系统中文字体的 Linux 运行时仍能绘制中文，不在生成时联网取字体。

PDF 使用 `NotoSansSC-PdfRegular.ttf`，来自 Google Fonts 的 Noto Sans SC TrueType 可变字体，按 `wght=400` 固定为 Regular，避免 CFF/OpenType 在部分 PDF 阅读器中的嵌入类型差异；许可见 PDF-FONT-LICENSE。

原始来源：https://github.com/google/fonts/blob/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf

使用 FontTools 4.62.1：`instantiateVariableFont(font, {'wght': 400}, inplace=True, updateFontNames=True)` 后保存；产物 SHA-256 为 `c047e310a7bc5f52fcd27e4fe4ffc4e0ef7e386cddeb390e3c713a79f69b4825`。字体只用于服务端 PDF 子集嵌入，不在运行时联网下载，也不修改既有 PNG 字体。
