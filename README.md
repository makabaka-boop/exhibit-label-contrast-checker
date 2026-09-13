# 博物馆展签对比度核验台

送印前核验展签配色的纯浏览器工具：TypeScript + React + Vite，无任何外部在线调用，无占位计算。

## 核验规则

- **输入**：前景色与背景色仅接受 `#RRGGBB` 六位十六进制；字号为大于 0 的 CSS 像素数；字重为普通或粗体。
- **公式**：每个 sRGB 通道除以 255 后，不大于 0.04045 时除以 12.92，否则取 `((v + 0.055) / 1.055) ^ 2.4`；相对亮度 `L = 0.2126R + 0.7152G + 0.0722B`；对比度 `(L亮 + 0.05) / (L暗 + 0.05)`。
- **分类**：普通字重 ≥ 24px 或粗体 ≥ 18.66px 归为大号文字。
- **阈值**：普通文字 AA / AAA 为 4.5 / 7；大号文字为 3 / 4.5。
- **裁决**：一律使用未舍入比值，等于阈值即通过；仅展示值四舍五入到两位。
- **容错**：任一字段非法时就地报错，并保留上一份有效结果。
- **结果**：结果卡呈现原始配色、两位比值及普通/大号文字的 AA、AAA 四项结论，可复制与当前结果一致的纯文本摘要。

## 本地开发

```bash
npm install
npm run dev        # 开发服务器
npm run test:unit  # Vitest：公式、分类、阈值边界
npm run test:e2e   # Playwright：合法输入、错误保留、摘要复制（自动构建并预览）
npm run verify     # 单元 + 端到端完整验收
```

## Docker Compose

```bash
# 启动浏览器应用（宿主端口默认 8080，可用 WEB_PORT 覆盖）
WEB_PORT=9000 docker compose up web

# 一次性验收服务：对 web 服务运行 Vitest + Playwright，结束后退出
docker compose run --rm verify
# 或
docker compose up --exit-code-from verify verify
```

- `web`：多阶段构建，nginx 托管静态产物，容器内端口 80。
- `verify`：基于官方 Playwright 镜像（浏览器已预装），等待 `web` 就绪后执行 `npm run verify`，退出码即验收结论。

## 目录结构

```
src/lib/contrast.ts    # 纯函数：解析、线性化、亮度、对比度、分类、裁决、摘要
src/App.tsx            # 表单、就地报错、结果卡、复制摘要
tests/contrast.test.ts # Vitest 单元测试
e2e/app.spec.ts        # Playwright 端到端测试
scripts/wait-for-web.mjs # verify 容器等待 web 就绪
```
