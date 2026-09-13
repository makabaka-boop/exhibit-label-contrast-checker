# syntax=docker/dockerfile:1

# 构建阶段：安装依赖并产出静态文件
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# 运行阶段：纯静态托管，无任何外部在线调用
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
