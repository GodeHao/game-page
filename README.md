# 星海谣 · Starlight Bloom

一款纯前端的唯美星空飞行收集小游戏。驾驶星瓣小舟，收集飘散的星辉，躲开暗云与陨石。

## 玩法

- **移动**：鼠标 / 手指拖动，或键盘 ← → ↑ ↓ / WASD
- **目标**：收集星辉得分，连续拾取触发最高 ×5 连击倍率
- **道具**：护盾 · 缓速 · 磁引 · 心（回血）
- **关卡**：累计分数推进，共 5 套星域配色轮换
- **暂停**：Esc / 空格　　**全屏**：F 键或右上角 ⛶

## 账号

- 注册账号后方可登录，账号必须使用 **QQ 邮箱**（支持 qq.com / vip.qq.com / foxmail.com）
- 密码经自定义哈希后存入 localStorage，不保存明文
- 每个账号独立保存最高分

## 运行

无需构建、无依赖，直接用浏览器打开 `index.html` 即可。

## 结构

```
index.html
assets/css/style.css
assets/js/store.js   账号存储 / 分数
assets/js/auth.js    登录注册界面逻辑
assets/js/game.js    游戏主逻辑与渲染
```
