# 地图数据目录

此目录用于存放离线地图数据文件。

## 生成 beijing_map_data.json

1. 在开发环境启动项目
2. 打开地图页面（确保高德地图已加载）
3. 打开浏览器控制台（F12）
4. 执行以下命令：

```javascript
// 获取地图实例和 AMap 对象
const mapController = window.__mapController; // 需要在 MapClient 中暴露
const AMap = window.AMap;

// 导入并执行导出函数
import('/src/utils/exportMapData.js').then(module => {
  module.downloadAmapData(mapController?.getMapInstance(), AMap);
});
```

或者更简单的方式（如果已经在全局暴露）：

```javascript
window.__exportMapData(window.__mapController?.getMapInstance(), window.AMap);
```

5. 浏览器会自动下载 `beijing_map_data.json` 文件
6. 将下载的文件放到此目录下

## 文件结构

```
public/data/
├── README.md                  # 本说明文件
└── beijing_map_data.json      # 北京地图数据（需要生成）
```

## beijing_map_data.json 数据结构

```json
{
  "version": "1.0.0",
  "generatedAt": "2026-04-03T10:00:00.000Z",
  "districts": [
    {
      "name": "朝阳区",
      "boundaries": [
        [[116.123, 39.456], [116.234, 39.567], ...]
      ]
    }
  ],
  "subways": [
    {
      "name": "地铁1号线",
      "path": [[116.123, 39.456], [116.234, 39.567], ...],
      "stations": [
        {
          "id": "BV10000001",
          "name": "天安门东",
          "center": [116.123, 39.456]
        }
      ]
    }
  ]
}
```
