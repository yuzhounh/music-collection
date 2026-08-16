# 网易云 + 酷我歌单导出工具

把网易云音乐、酷我音乐的歌单曲目**元数据**导出为 CSV 和 JSON，并按“歌曲名 + 歌手”合并去重。工具只读取歌单信息，**不下载音频、不破解会员、不绕过 DRM**。

## 能做什么

- 输入一个或多个网易云/酷我歌单链接或数字 ID
- 支持公开歌单；私有歌单可尝试读取 Chrome、Edge 或 Firefox 的已有登录 Cookie
- 输出字段：歌曲名、歌手、专辑、来源平台、歌曲/资源 ID、歌单名称、歌曲页面链接
- CSV 使用 UTF-8 BOM，Windows Excel 可直接打开中文
- 一个歌单失败时继续导出其他成功歌单；`--strict` 可改为遇错停止
- 每个平台都是独立适配器，后续可按相同接口加入 QQ 音乐、酷狗

> 平台网页接口并非公开、稳定的开发者 API，平台更新后可能需要调整适配器。请只导出自己有权访问的数据，并遵守平台条款。

## 最简单的 Windows 用法

1. 安装 Python 3.10 或更新版本，安装时勾选 **Add Python to PATH**。
2. 双击 `run_windows.bat`。首次运行会在项目内创建 `.venv` 并安装依赖。
3. 粘贴网易云、酷我歌单链接（不需要的平台直接回车）。
4. 结果在 `output\favorites_merged.csv` 和 `output\favorites_merged.json`。

双击脚本适合各导出一个歌单。多个歌单或浏览器登录态请用下面的命令行方式。

## 命令行用法

在 PowerShell 中进入本目录：

```powershell
py -3 -m venv .venv  # 若没有 py，可改为 python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

导出并合并两个平台：

```powershell
.\.venv\Scripts\python.exe export_playlists.py `
  --netease "https://music.163.com/#/playlist?id=123456" `
  --kuwo "https://www.kuwo.cn/playlist_detail/987654"
```

同一参数可以反复使用：

```powershell
.\.venv\Scripts\python.exe export_playlists.py `
  --netease 123456 --netease 234567 `
  --kuwo 987654 --kuwo 876543
```

### 私有收藏/歌单

先在浏览器中正常登录相应音乐网站，再执行：

```powershell
.\.venv\Scripts\python.exe export_playlists.py --browser edge --netease 123456 --kuwo 987654
```

`--browser` 可选 `edge`、`chrome`、`firefox`。工具只读取本机 Cookie，不读取或保存账号密码。Windows/浏览器可能暂时锁定 Cookie 数据库；遇到读取失败时，关闭对应浏览器后重试。浏览器登录态仍受平台权限与接口限制，不保证所有“我喜欢”页面都能自动枚举；最可靠的方法是在客户端中打开目标收藏歌单，使用其“分享/复制链接”，然后把链接交给本工具。

如浏览器 Cookie 无法自动读取，可由用户自己显式设置临时环境变量（不要把 Cookie 写进代码或提交到 Git）：

```powershell
$env:NETEASE_COOKIE = "MUSIC_U=...; __csrf=..."
$env:KUWO_COOKIE = "kw_token=..."
.\.venv\Scripts\python.exe export_playlists.py --netease 123456 --kuwo 987654
Remove-Item Env:NETEASE_COOKIE, Env:KUWO_COOKIE -ErrorAction SilentlyContinue
```

## 参数

```text
--netease URL_OR_ID   网易云歌单链接/ID，可多次使用
--kuwo URL_OR_ID      酷我歌单链接/ID，可多次使用
--browser BROWSER     edge / chrome / firefox
--output DIR          输出目录，默认 output
--no-dedupe           不去重
--strict              任一歌单失败即停止，不生成部分结果
```

## 输出示例

```csv
title,artists,album,platform,resource_id,playlist_name,link
晴天,周杰伦,叶惠美,netease,186016,我喜欢的音乐,https://music.163.com/song?id=186016
```

去重会规范化大小写、全角/半角和标点，再比较“歌曲名 + 歌手”。不同版本（例如 Live、伴奏）只要名称不同就会保留。若确实重复，保留输入顺序中最先出现的一条。

## 保留歌单归属并分类

需要跨平台汇总多个原始导出时，第一次导出请使用 `--no-dedupe`，再把生成的 JSON 交给分类入口：

```powershell
.\.venv\Scripts\python.exe merge_and_classify.py `
  .\work\netease_all_raw\favorites_merged.json `
  .\work\kuwo_all_raw\favorites_merged.json `
  --output .\output\classified
```

分类入口会按“歌曲名 + 歌手”去重，但保留所有来源平台、资源 ID、歌曲链接和原歌单名称。分类优先使用原歌单中的“流行、外文、轻音乐、影视”等归属；没有明确归属时，再根据标题、歌手、专辑关键词及文字语言推断，并将低置信度或分类冲突的记录标记为“需复核”。

分类输出包括总表 CSV/JSON、各类别 CSV，以及字段：主分类、其他分类、标签、置信度、分类依据、是否需复核、原歌单归属次数。

## 播放地址可用性抽样检测

已经生成分类结果后，可以分别抽取网易云和酷我各 15 首，检测平台当前是否返回播放地址：

```powershell
.\.venv\Scripts\python.exe scan_audio_availability.py
```

报告保存在 `output\audio_availability`，包括 CSV、JSON 和汇总文件。此功能只请求播放地址元数据，**不会下载音频内容**；返回的地址通常有时效性，并继续受账号登录、会员权限、地区及平台规则限制。需要使用已有浏览器登录态时可增加 `--browser edge`（也支持 `chrome`、`firefox`）。

对于检测为不可用的歌曲，还可以继续检索 MV/视频候选：

```powershell
.\.venv\Scripts\python.exe scan_mv_fallback.py
```

检索顺序为网易云 MV、酷我 MV、哔哩哔哩，国内未找到可信候选时才检索 YouTube。结果只包含候选页面、匹配分数和是否可播放的检测状态，**不会下载视频，也不会提取视频音轨**。低分候选会标记为需要人工复核。

## 项目结构与扩展

```text
export_playlists.py          命令行入口
merge_and_classify.py        跨平台合并、保留归属并自动分类
scan_audio_availability.py   播放地址可用性抽样检测（不下载音频）
scan_mv_fallback.py          音频不可用歌曲的MV/视频回退检索
build_music_site.py          由分类结果生成静态音乐收藏网页数据
music_exporter/base.py       平台适配器抽象接口
music_exporter/netease.py    网易云适配器
music_exporter/kuwo.py       酷我适配器
music_exporter/models.py     统一曲目字段
music_exporter/output.py     去重及 CSV/JSON 输出
music_exporter/cookies.py    浏览器/显式 Cookie 支持
```

新增平台时继承 `PlaylistAdapter`，实现 `export_playlist(value) -> list[Track]`，再在入口注册参数与适配器即可。输出与去重逻辑无需修改。

## 音乐收藏网页

`docs` 目录是可以直接部署到 GitHub Pages 的静态网站，默认提供“全部、流行歌曲、外文歌曲、纯音乐、影视原声”标签，并支持搜索、来源筛选和分页。网页只展示歌曲元数据及原平台链接，不包含音频文件。

分类结果更新后重新生成网页数据：

```powershell
.\.venv\Scripts\python.exe build_music_site.py
```

本地预览：

Windows 用户可以直接双击项目根目录中的 `打开音乐网页.bat`，脚本会启动本地服务并自动打开浏览器。服务窗口需要保持打开；关闭该窗口后，`localhost:8000` 将无法访问。

也可以在 PowerShell 中手动运行：

```powershell
.\.venv\Scripts\python.exe -m http.server 8000 --directory docs
```

然后打开 `http://localhost:8000/`。在 GitHub 仓库设置中将 Pages 来源设为默认分支的 `/docs` 目录即可发布。

### 一键更新收藏网页

平时继续在酷我“我的 → 收藏”和网易云“我的 → 我喜欢的音乐”中收藏歌曲即可。Windows 下双击项目根目录的 `更新音乐网页.bat`，工具会根据 `playlists.json` 重新抓取全部已登记歌单、合并去重、重新分类、生成网页数据，并在数据确实发生变化时提交和推送 GitHub。

更新采用临时目录完成全部抓取和分类；任何歌单失败、结果为空，或新结果低于旧数据安全比例时，都不会覆盖现有网页。完成后会显示新增、删除和当前歌曲数。新建歌单后，只需把公开分享链接及名称补充到 `playlists.json` 对应平台列表中。

默认公开网页地址：`https://yuzhounh.github.io/music-collection/`。
