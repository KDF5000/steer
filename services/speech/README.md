# Steer Speech（Build 8）

Build 10：手机本地识别已加入 iOS 26+ 的 `SpeechAnalyzer` / `SpeechTranscriber`，模型就绪时默认使用，另可选标准听写。六条合成录音真机对照的处理耗时中位数为新引擎 149ms、旧引擎 208ms；中文开头识别改善，但中英项目名样本新引擎更差，不宣称全面更准。完整手机输入链路及取消恢复已验证；详见 `apple/README.md` 和 `verification/iphone-enhanced-*.json`。本 Docker 服务未改动。

用户已在关闭自托管的情况下通过真实 Watch 复测，反馈包含英文也能正确转写；当前继续默认使用增强本地引擎，保留标准听写与自托管选项。

Build 9 补充：修复配对 iPhone 识别路径将系统 locale 当作录音语言的问题，默认显式 zh-CN；设置可选英语。手机返回实际本地/Apple 云端来源，Watch 确认页显示。关闭自托管改为立即保存同步。Docker 服务未改动。真实 iPhone 合成音频对照已复现英语乱码并验证中文路径；报告见 `verification/iphone-language-comparison.json`、`verification/iphone-local-language-fix.json`，详细行为见 `apple/README.md`。

用户已保持自托管关闭，用真实 Watch 重新输入中文并确认恢复正常。手机端 Build 9 对旧 Watch Build 8 也生效；手表上的来源标签需要 Watch 更新至 Build 9。

## 当前部署：Docker + Caddy（取代下方原生部署）

实际路径：**Watch / iPhone → Caddy → Docker 内 SenseVoice INT8 → 文字确认 → Steer 任务**。容器独立运行识别，不调用 macOS MLX 服务。模型路径可替换，客户端接口保持一致。

| 入口 | 用途 |
|---|---|
| `http://192.168.31.248:18766` | Caddy 局域网联调，已保存到 iPhone 并发往 Watch |
| `https://steer-server.pcursor.run:8443/speech` | 已有 Caddy TLS 站点下的新路径；公网网络配置由用户管理 |
| `127.0.0.1:18765` | Docker 发布端口，仅供宿主 Caddy 转发 |

已修改、校验并重载 `/Users/kongdefei/glot-proxy/Caddyfile`：新增 `/speech/*` 的 `handle_path`，去掉前缀后转发容器；原 Steer 路径保留在 catch-all `handle` 中。新增 HTTP 18766 联调入口。备份为 `Caddyfile.backup-before-speech-20261108175445`，没有修改 DNS、端口映射或 Cloudflare 隧道。

容器为 `steer-speech-speech-1`，`restart: unless-stopped`，单活动请求、两核 CPU、2GiB 内存上限，当前约占 566MiB。主机与 Docker/OrbStack 需要保持运行。

原 macOS Qwen 服务已停止，LaunchAgent 改为 `com.steer.speech.plist.disabled`，避免登录时重复启动。环境和模型保留作后续对照；恢复原生版本可重新运行其 `install.py`。

### 重建容器

在目标 Mac 的 `/Users/kongdefei/services/steer-speech`：

```bash
python3 download-model.py
# 首次部署才生成密钥；已有文件保留。
python3 -c 'from pathlib import Path; import secrets; p=Path("speech.secret"); p.exists() or p.write_text(secrets.token_urlsafe(32)+"\n"); p.chmod(0o600)'
docker compose up -d --build
docker compose ps
docker compose logs --tail 40 speech
```

SenseVoice 模型 revision 为 `2365baeacb507f821a0c8120fcee3d484dba7a07`，下载脚本验证模型、tokens、许可文件的 SHA-256。模型只读挂载，密钥以文件 secret 挂载，主机权限为 0600。Compose 的 `SPEECH_UID` / `SPEECH_GID` 默认 501/20，应与 secret 所有者一致。

本次 Docker 镜像代理返回 403，Docker Hub/ECR 直连超时，因此只将已经缓存的 `ghcr.io/immich-app/immich-machine-learning:v2` 打上 `steer-speech-bootstrap:local` 标签作为构建基础，再建立独立 `/speech-venv` 并清除原 entrypoint。没有修改或重启 Immich，也不调用其服务。目标服务目录的 `.env` 记录此次网络适配：

```dotenv
SPEECH_BASE_IMAGE=steer-speech-bootstrap:local
SPEECH_APT_MIRROR=mirrors.aliyun.com
SPEECH_PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple
```

网络可用时可去掉覆盖项，使用默认 Python 3.12 slim 基础镜像；当前缓存基础为 Python 3.11。直接依赖固定在 `requirements.docker.txt`，实际完整版本记录于 `requirements.docker.lock.txt`。服务根文件系统只读、临时音频放在 tmpfs；父进程负责取消后的临时文件清理。

### 新增真机与容器验证

- Swift 核心测试 15 项通过，增加了 Caddy 路径前缀回归；Python API 合约测试 4 项通过。
- Docker 经 Caddy：3.968 秒合成中文 M4A 三次识别正确，服务端总处理 184/102/102ms，识别部分 74/65/65ms。不是人声准确率或 p95 基准。
- **iPhone 真机经 Caddy → Docker 正确识别，271ms**。保留原 Steer 服务器与 Workspace Key，仅保存独立语音配置并发往配对 Watch；随后收到 Watch Build 8 回执，确认已接收 `http://192.168.31.248:18766`。
- **Watch 真实录音已由用户验证**：出现正确文字，用户反馈速度可以。该验证覆盖录音→Caddy→Docker→文字确认，没有将手机合成音频测试当作手表实测，也没有代用户提交 Agent 任务。
- 取消上传后容器模型状态 busy → not ready → ready，恢复后再次识别成功；实际边界请求返回 400（空/坏音频）、413（过大）、401（错误密钥）。
- Caddy HTTPS `/speech/healthz` 用正确 SNI、正常证书校验从宿主验证通过；原 Steer API 未授权请求仍是 401。
- 脱敏结果存于 `verification/iphone.json`、`verification/docker-smoke.json`、`verification/watch-configuration.json`。Watch 收到新配置后回执，iPhone 显示「手表已确认收到配置」。

Debug 的 `STEER_REMOTE_SPEECH_SELF_TEST=1` 仅使用预先传入的合成音频，不打开麦克风、不提交任务。一次性配置在使用后删除。当前语音输入链路已通过 Watch 人工验证；本轮未再次验证任务提交、通知与朗读，公网路由仍由用户配置。

### 公网域名访问补充验证

2026-11-08，从开发机直接访问 `https://steer-server.pcursor.run:8443/speech`，使用正常 DNS 与 HTTPS 证书验证，没有 `--resolve`、指定目标 IP 或跳过证书校验：未带密钥的健康检查返回 401；带密钥的健康检查返回 200、ready=true；3.968 秒合成中文 M4A 转写返回 200，文字正确，客户端总耗时 257ms，服务端处理 216ms，其中识别 68ms。该 HTTPS 入口已实际可用，无需额外公网配置。本轮只测试入口，没有修改手机/手表当前保存的局域网地址。

## 以下为首次原生 MLX 部署记录（历史）

面向 Watch 短句输入的独立 ASR 服务，首个后端为 Qwen3-ASR 0.6B 8bit / MLX。
Watch 录音后直接调用服务，识别结果供用户确认，再沿用现有 Steer 任务接口。
服务不会创建任务，也不持久化用户录音或记录转写正文。当前没有流式麦克风、对话 LLM 或服务端 TTS。

## 本次部署

- 主机：`kongdefei@192.168.31.248`，M4 16GB，macOS 26.4.1。
- 服务目录：`/Users/kongdefei/services/steer-speech`，Python 3.13 独立虚拟环境。
- 局域网地址：`http://192.168.31.248:8765`。
- LaunchAgent：`com.steer.speech`，登录后常驻；Mac 需保持开机、联网并避免睡眠。
- 模型 revision：`89e96d92ba34aca20b3e29fb10cc284097d1219f`，本地 `model.path` 固定到已下载快照。
- 独立密钥保存在服务目录的 `speech.secret`，权限 0600；不复用 Workspace API Key。
- 本开发机的受限副本：`apple/.cache/speech-service.secret`（被 Git 忽略，不打包进 App）。

公网 HTTPS 地址尚待提供。公网反向代理应转发到该端口，保留 Authorization，并允许至少 65 秒请求时间；目前文件接口无需 WebSocket，也无需 SSE。不要将局域网 HTTP 当作公网传输方案。

## iPhone / Watch 配置

1. 更新 iPhone 和配对 Watch 上的 Steer 到 Build 8。签名 iPhone App 内已包含 Watch App；Watch 是否自动安装/更新由配对系统决定，也可在 iPhone 的 Watch App 中确认。
2. 打开 iPhone Steer，保留原 Steer 服务器与 Workspace Key，开启「使用自托管语音服务」。
3. 语音服务地址填上述地址（或后续公网 HTTPS 地址），密钥填 `speech.secret` 内容，点击「验证并同步到手表」。两项服务都验证成功才保存。
4. Watch 打开已完成任务，点「语音」→ 说话 →「完成」→ 核对文字 →「发送」。取消不会提交任务。
5. 任务结束后结果仍是文字。用户点「朗读结果」才用系统声音播放；开始新录音或离开页面会停止朗读。

同一局域网内可先测试；Watch 独立蜂窝访问需要公网地址。选择自托管后不再要求 iPhone 可达或取得手机语音识别权限，也不会自动回退其他识别服务。关闭自托管并重新保存，恢复原来的配对 iPhone 识别路径。

## API

所有接口都需要 `Authorization: Bearer <独立语音密钥>`。

- `GET /healthz`：`ready`、`busy`、`model`；加载或恢复中返回 503。
- `POST /v1/audio/transcriptions?language=zh`：请求体是**原始音频字节**，例如 `Content-Type: audio/mp4`，不是 multipart，也不宣称完整兼容 OpenAI 上传协议。支持 `zh`、`en`、`auto`；Watch 当前固定使用默认中文。
- 成功返回 `text`、`request_id`、`audio_seconds`、`recognition_ms`、`elapsed_ms`、`model`。
- 最大上传 2MiB，音频 0.1–30 秒；Watch UI 当前上限仍为 20 秒。
- 未授权 401，坏音频/空音频/不支持语言 400，文件过大 413，忙碌/恢复中 503，超时 504。
- 单活动请求，不积压识别队列；上传最多 20 秒，识别最多 45 秒。断开或超时将终止专用模型进程并在后台重新加载，以真正停止原生推理；短暂恢复期间拒绝新请求。

## 重建与维护

在目标 Apple Silicon Mac 安装 Python 3.13、FFmpeg。复制本目录后：

```bash
python3.13 -m venv .venv
.venv/bin/pip install -r requirements.lock.txt
.venv/bin/python -c 'from huggingface_hub import snapshot_download; from pathlib import Path; p=snapshot_download("mlx-community/Qwen3-ASR-0.6B-8bit", revision="89e96d92ba34aca20b3e29fb10cc284097d1219f"); Path("model.path").write_text(p+"\n")'
.venv/bin/python install.py
```

`install.py` 保留已存在的独立密钥，只管理 `com.steer.speech`，不会改动其他服务。
`requirements.lock.txt` 为本次实际安装的完整版本；`requirements.txt` 列出直接依赖。

```bash
launchctl print gui/$(id -u)/com.steer.speech
launchctl kickstart -k gui/$(id -u)/com.steer.speech
tail -n 40 service.log
# 停用（保留模型、配置和密钥）
launchctl bootout gui/$(id -u)/com.steer.speech
```

## 验证结果（2026-11-08）

- `swift test --package-path apple`：14 项通过，包含旧配对配置兼容、独立语音密钥和音频路由、服务失败不回退、空/过大录音拦截。
- `.venv/bin/python -m unittest -v test_service`：4 项通过。
- iPhone + Watch 无签名构建和真机签名构建均通过；Build 8 已安装到可达 iPhone，包名 `com.kongdefei.steer.phone`。
- 使用 macOS `say -v Tingting` 生成约 3.968 秒中文，再编码为 16kHz 单声道 M4A，与 Watch 当前录音格式匹配。
- 预热后三次正确识别为「请总结当前任务的状态，不要修改代码。」；服务端总处理耗时 313/209/209ms，识别部分 254/163/162ms。这是单条合成音频测试，不是人声准确率或 p95 基准。
- 从开发机运行实际 `RemoteSpeech` Swift URLSession 客户端，经局域网得到相同文字；最终版本使用 ContinuousClock 测得 284ms。没有用假模型代替这一测试；冷启动和取消后重载耗时另计。
- 实际上传后断开连接，观察专用模型进程退出、更换 PID，状态从 busy → not ready → ready，恢复后再次识别成功。
- 空文件和非音频请求实际返回 400；局域网认证请求可用。

尚待用户操作验证：iPhone 当前锁屏无法自动启动 App；Xcode 未列出可直接安装的 Watch 真机，因此未确认 Watch 已更新。需要打开手机和手表 App，保存语音服务配置，实测 Watch 录音→文字确认→提交→任务通知及系统朗读。尚未配置公网入口，也未更改已有 Steer/Relay 服务器。
