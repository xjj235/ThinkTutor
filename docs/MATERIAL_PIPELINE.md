# 课程材料流水线

教师申请上传 → 服务端校验课程所有权、扩展名、MIME 和大小 → 生成随机 `materials/{userId}/{uuid}.ext` Key → 浏览器直传私有 OSS/本地签名入口 → 服务端 HEAD 二次确认 → BullMQ 排队 → Worker 魔数校验与文本提取 → 语义段落切块 → `MaterialChunk` 原子替换 → READY。

支持 PDF、DOCX、TXT、Markdown；PPTX 明确提示导出 PDF。原文件名仅用于展示，绝不参与完整对象 Key。OSS 下载先鉴权再生成 5 分钟签名 URL；Bucket 必须 private。Worker 任务以 material ID 幂等，失败记录 code/message/retryCount，不静默吞错。

Redis/Tair 中 BullMQ 使用 `thinktutor` 前缀。生产 Web 与 Worker 是两个独立容器；文件不永久保存在 ECS。
