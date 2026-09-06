import type {
  AIUsageStatus,
  AssignmentProgress,
  AssignmentStatus,
  AuditAction,
  CourseStatus,
  GapStatus,
  MaterialStatus,
  UserRole,
  UserStatus,
} from "@prisma/client";

export const userRoleLabels = {
  STUDENT: "学生",
  TEACHER: "教师",
  ADMIN: "管理员",
} satisfies Record<UserRole, string>;

export const userStatusLabels = {
  ACTIVE: "正常",
  DISABLED: "已停用",
  DELETED: "已删除",
} satisfies Record<UserStatus, string>;

export const courseStatusLabels = {
  DRAFT: "草稿",
  PUBLISHED: "已发布",
  ARCHIVED: "已归档",
} satisfies Record<CourseStatus, string>;

export const assignmentStatusLabels = {
  DRAFT: "草稿",
  PUBLISHED: "已发布",
  CLOSED: "已关闭",
  ARCHIVED: "已归档",
} satisfies Record<AssignmentStatus, string>;

export const assignmentProgressLabels = {
  NOT_STARTED: "未开始",
  IN_PROGRESS: "学习中",
  COMPLETED: "已完成",
} satisfies Record<AssignmentProgress, string>;

export const materialStatusLabels = {
  PENDING_UPLOAD: "待上传",
  UPLOADED: "已上传",
  QUEUED: "等待处理",
  PROCESSING: "处理中",
  READY: "可检索",
  FAILED: "处理失败",
  UNSUPPORTED: "不支持",
  DELETED: "已删除",
} satisfies Record<MaterialStatus, string>;

export const gapStatusLabels = {
  OPEN: "待修复",
  IN_PROGRESS: "修复中",
  RESOLVED: "已解决",
  DISMISSED: "已忽略",
} satisfies Record<GapStatus, string>;

export const aiUsageStatusLabels = {
  SUCCESS: "成功",
  FAILED: "失败",
} satisfies Record<AIUsageStatus, string>;

export const auditActionLabels = {
  KNOWLEDGE_REVIEWED: "知识与教学判断审核",
  AUTH_LOGIN: "登录",
  AUTH_LOGOUT: "退出登录",
  AUTH_LOGIN_FAILED: "登录失败",
  USER_REGISTERED: "用户注册",
  USER_PASSWORD_CHANGED: "修改密码",
  USER_DELETED: "删除用户",
  USER_ROLE_CHANGED: "修改用户角色",
  USER_STATUS_CHANGED: "修改用户状态",
  COURSE_CREATED: "创建课程",
  COURSE_UPDATED: "更新课程",
  MATERIAL_UPLOADED: "上传材料",
  MATERIAL_DELETED: "删除材料",
  CLASSROOM_CREATED: "创建班级",
  ENROLLMENT_CHANGED: "变更班级成员",
  ASSIGNMENT_PUBLISHED: "发布学习任务",
  SESSION_CREATED: "创建学习会话",
  SESSION_COMPLETED: "完成学习会话",
  REPORT_CREATED: "生成学习报告",
  ADMIN_CREATED: "创建管理员",
  ROLE_CHANGE: "修改角色",
  USER_DISABLE: "停用用户",
  COURSE_DELETE: "删除课程",
  MATERIAL_DELETE: "删除材料",
  ASSIGNMENT_PUBLISH: "发布学习任务",
  ADMIN_LOGIN: "管理员登录",
} satisfies Record<AuditAction, string>;

const aiOperationLabels = {
  diagnostic: "知识诊断",
  coach: "苏格拉底追问",
  feynman_instruction: "费曼讲解说明",
  report: "学习报告",
  retry_task: "漏洞再练",
  context_summary: "学习上下文摘要",
  material_keywords: "材料关键词提取",
} as const;

const auditTargetTypeLabels = {
  User: "用户",
  Course: "课程",
  Material: "课程材料",
  Classroom: "班级",
  Enrollment: "班级成员",
  Assignment: "学习任务",
  LearningSession: "学习会话",
  LearningReport: "学习报告",
  Admin: "管理员",
} as const;

function labelFromStringMap<T extends Readonly<Record<string, string>>>(
  labels: T,
  value: string,
): string {
  if (Object.prototype.hasOwnProperty.call(labels, value)) {
    return labels[value as keyof T];
  }
  return value;
}

export function aiOperationLabel(operation: string): string {
  return labelFromStringMap(aiOperationLabels, operation);
}

export function auditTargetTypeLabel(targetType: string): string {
  return labelFromStringMap(auditTargetTypeLabels, targetType);
}
