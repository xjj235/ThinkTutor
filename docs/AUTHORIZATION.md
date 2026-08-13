# 认证与授权

密码使用 Argon2id。浏览器只保存 `HttpOnly + SameSite=Lax` 的随机会话 Token；数据库只保存 SHA-256 Token 哈希，生产 Cookie 强制 Secure。退出、改密、停用和删除会撤销相关会话。

公共注册固定创建 `STUDENT`；不得请求或自行注册教师/管理员。管理员通过交互式 `pnpm admin:create` 初始化，密码不回显且拒绝覆盖已有邮箱。

Route Handler 先认证角色，再调用资源级授权：课程 `ownerId`、班级 `teacherId/membership`、学习会话 `userId/assignment.createdById`。CUID 不是授权。Student A 不能读取 Student B 会话；Teacher A 不能读取 Teacher B 班级；学生不能调用教师 API，教师不能调用管理员 API；停用用户的旧 Cookie 无法继续使用。
