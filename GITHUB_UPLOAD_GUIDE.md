# GitHub 作品集上传教程

这份文件夹已经整理成可直接上传的静态项目。推荐使用独立的 GitHub 仓库，并通过 GitHub Pages 提供在线演示。

## 一、选择仓库形式

### 方案 A：独立项目仓库（推荐）

仓库名建议：

```text
insightflow-ecommerce-analytics
```

个人主页链接形式：

```text
https://github.com/<你的用户名>/insightflow-ecommerce-analytics
https://<你的用户名>.github.io/insightflow-ecommerce-analytics/
```

### 方案 B：作品集总仓库中的子项目

如果已经有 `portfolio` 或个人主页仓库，可以把本文件夹放到：

```text
projects/insightflow-ecommerce-analytics/
```

这种方式适合把所有面试项目集中在一个仓库。注意 GitHub Pages 的入口路径会变成：

```text
https://<你的用户名>.github.io/<仓库名>/projects/insightflow-ecommerce-analytics/
```

## 二、上传前检查

上传的是子文件夹里的内容。不要把上级开发目录、浏览器测试记录、临时截图或测试脚本一起上传。

确认以下文件存在：

```text
index.html
README.md
GITHUB_UPLOAD_GUIDE.md
assets/
data/
docs/
js/
scripts/
```

确认不存在以下内容：

```text
.env
.env.local
*.key
真实的 API Key 字符串
node_modules/
浏览器用户数据目录
本地导出的临时 PDF / 截图堆
```

本地检查命令：

```powershell
git grep -n "apiKey"
git status
```

`apiKey` 出现在读取和请求逻辑中是正常的；如果出现真实 Key 字符串，必须先删除再提交。

## 三、创建 GitHub 仓库

1. 登录 GitHub；
2. 点击右上角 `+` → `New repository`；
3. 仓库名填写 `insightflow-ecommerce-analytics`；
4. 选择 `Public`；
5. 不建议勾选“自动创建 README”，因为本文件夹已经有 README；
6. 点击 `Create repository`。

## 四、上传文件

### 网页上传

1. 打开新仓库；
2. 点击 `Add file` → `Upload files`；
3. 打开 `portfolio/insightflow-ecommerce-analytics/` 文件夹；
4. 选中其中的全部内容上传；
5. 如果仓库根目录就是 `index.html`，不要只上传外层的 `insightflow-ecommerce-analytics` 文件夹，否则网页会多一层路径；
6. 填写提交说明，例如 `Add InsightFlow ecommerce analytics portfolio demo`；
7. 点击 `Commit changes`。

### Git 命令行

在 GitHub 创建空仓库后执行：

```powershell
cd portfolio/insightflow-ecommerce-analytics
git init
git add .
git commit -m "Add InsightFlow ecommerce analytics portfolio demo"
git branch -M main
git remote add origin https://github.com/<你的用户名>/insightflow-ecommerce-analytics.git
git push -u origin main
```

## 五、开启 GitHub Pages

1. 打开仓库；
2. 进入 `Settings`；
3. 左侧选择 `Pages`；
4. `Build and deployment` 的 Source 选择 `Deploy from a branch`；
5. Branch 选择 `main`；
6. 文件夹选择 `/(root)`；
7. 点击 `Save`；
8. 等待 1–3 分钟，页面顶部会显示发布地址。

发布地址通常为：

```text
https://<你的用户名>.github.io/insightflow-ecommerce-analytics/
```

首页文件是根目录的 `index.html`，与当前静态文件结构匹配。

## 六、完善仓库展示

在仓库右侧 About 区域填写：

**Description**

> Specialist AI workbench for e-commerce event-log cleaning, retention/funnel/RFM analysis and chart-grounded reporting.

**Topics 建议**

```text
data-analysis
ecommerce-analytics
ai-agent
echarts
javascript
portfolio-project
data-warehouse
ods-dwd-ads
```

建议把仓库 Pin 到 GitHub 个人主页。面试官优先看到 README、在线 Demo 和截图，而不是杂乱文件列表。

## 七、API Key 与线上面试演示

- 仓库不包含任何 API Key；
- 在线演示时，Key 由访问者在“AI 配置”面板中输入；
- Key 只保存在当前浏览器的 localStorage；
- 演示结束点击“清除配置”；
- 不要把自己的长期有效 Key 写进 HTML、README、截图或提交历史；
- 如果曾经误提交真实 Key，应立即到模型服务商后台撤销该 Key，再清理 Git 历史；
- 纯前端直接调用 DeepSeek 仅适合作品集演示，正式产品必须使用后端代理。

## 八、上传后自测

使用无痕浏览器打开 GitHub Pages 地址：

1. 等待模拟数据自动加载；
2. 点击“一键生成分析宽表”；
3. 运行漏斗和留存分析；
4. 打开一键报告页面；
5. 不配置 Key 时应正确提示，而不是静默失败；
6. 配置临时 Key 后测试 AI 报告；
7. 导出 HTML，并检查图表为内联图片；
8. 使用浏览器打印预览检查 PDF 排版；
9. 清除 API 配置并刷新，确认页面核心分析功能仍可用；
10. 手机宽度下检查是否没有页面级横向滚动。

## 九、常见问题

### 页面打开后没有图表

需要联网加载 ECharts CDN。网络不可用时会使用轻量 Canvas 后备图，联网后恢复 ECharts。

### AI 按钮提示缺少配置

这是预期行为。进入“AI 配置”，使用自己的临时 Key。

### GitHub Pages 显示 404

检查 Pages 分支是否为 `main`、目录是否为 `/(root)`，并确认根目录存在 `index.html`。

### 上传后页面出现多一层目录

把子文件夹内部的内容放到仓库根目录，或相应修改 Pages 路径；不要把父级开发目录整体上传。

### 为什么没有上传浏览器自动化脚本

浏览器冒烟测试依赖本地 Edge 调试端口和测试用模拟 Key，不适合作为作品集运行文件。作品集保留可直接运行的纯前端应用和核心数据链测试。
