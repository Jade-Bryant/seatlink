# SeatLink · 学校样式与偏好找座

此版本位于 **compact-preferences-ui** 独立分支；未合并 main，也未修改当前 GitHub Pages。

- 根目录：已构建的静态网页，可用任意静态服务器预览。
- `source/`：React + Vite 源码、测试和模拟数据说明。
- 学校样式：蓝色标题栏、浅蓝区域栏、白底时间选项、黄绿座位图、场馆首页与底部导航。
- 保留 ⋯ 偏好图标菜单、列表／地图、预约详情、拼座与续座；默认显示座位图。
- 「场景演示」中的东区预约回放支持导入本地实验汇总，复现方式见 [东区预约回放](source/README.md#c200-东区预约回放)。
- [模拟情况](source/docs/simulated-preferences.md)：显示屏、光线、隔板、空调、通道、附近人数均为合成数据。
- 环境偏好只用于单座推荐；拼座与续座保留原时间算法。

## 开发

```sh
git clone --branch compact-preferences-ui --single-branch https://github.com/xinranxu0830-boop/seatlink.git
cd seatlink/source
npm ci
npm run dev -- --port 5175
```

打开 http://127.0.0.1:5175/ 。

```sh
npm test
npm run build
# 开发服务运行时，用本机 Google Chrome 检查交互：
npm run test:ui
```

详见 [源码 README](source/README.md)。后续修改源码后在 source/ 运行构建，产物在 source/dist/；更新本分支根目录产物即可。不要向 main 推送或改变 Pages 发布分支，除非另行确认要替换线上版本。

当前在线页面仍来自 main，这个 GitHub 分支地址本身不是网页预览链接。
