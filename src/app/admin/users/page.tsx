import { listAdminUsers } from "@/lib/admin-service";
import { requirePageUser } from "@/lib/page-auth";
import { EmptyState, PageShell } from "@/components/page-shell";
import { AdminUserActions } from "@/components/admin-user-actions";
import { FilterForm } from "@/components/filter-form";
import { Pagination } from "@/components/pagination";
import { cleanSearch, firstSearchValue, parsePage, type SearchParams } from "@/lib/list-query";
import { userRoleLabels, userStatusLabels } from "@/lib/display-labels";

const roles = ["STUDENT", "TEACHER", "ADMIN"] as const;
const statuses = ["ACTIVE", "DISABLED", "DELETED"] as const;

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requirePageUser(["ADMIN"]);
  const parameters = await searchParams;
  const query = cleanSearch(parameters.query);
  const roleValue = firstSearchValue(parameters.role);
  const statusValue = firstSearchValue(parameters.status);
  const role = roles.find((value) => value === roleValue);
  const status = statuses.find((value) => value === statusValue);
  const page = parsePage(parameters.page);
  const data = await listAdminUsers({ limit: 20, page, query, role, status });

  return (
    <PageShell title="用户管理" description="搜索和筛选账号；角色、停用和删除操作会写入审计日志。">
      <FilterForm resetHref="/admin/users">
        <label>姓名或邮箱<input name="query" defaultValue={query} maxLength={120} /></label>
        <label>角色<select name="role" defaultValue={role ?? ""}><option value="">全部角色</option>{roles.map((value) => <option key={value} value={value}>{userRoleLabels[value]}</option>)}</select></label>
        <label>状态<select name="status" defaultValue={status ?? ""}><option value="">全部状态</option>{statuses.map((value) => <option key={value} value={value}>{userStatusLabels[value]}</option>)}</select></label>
      </FilterForm>
      {data.items.length ? (
        <div className="data-list">{data.items.map((user) => (
          <div className="data-row" key={user.id}>
            <span className="data-row-detail"><strong>{user.name}</strong><small>{user.email} · 创建于 {new Intl.DateTimeFormat("zh-CN").format(user.createdAt)}</small></span>
            <AdminUserActions id={user.id} name={user.name} role={user.role} status={user.status} isCurrentUser={user.id === actor.id} />
          </div>
        ))}</div>
      ) : <EmptyState title="没有匹配用户" description="调整搜索词或筛选条件后再试。" />}
      <Pagination pathname="/admin/users" page={data.page} totalPages={data.totalPages} query={{ query, role, status }} />
    </PageShell>
  );
}
