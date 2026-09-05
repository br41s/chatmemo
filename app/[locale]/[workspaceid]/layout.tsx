import { Dashboard } from "@/components/ui/dashboard"
import { WorkspaceHydrator } from "@/components/workspace/workspace-hydrator"
import { getWorkspaceData } from "@/lib/server/workspace-data"
import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { ReactNode } from "react"

/**
 * ARCH-11: this was a client component that rendered a full-page spinner,
 * hydrated, checked the session in the browser, issued ten reads through the
 * browser Supabase client, and only then rendered anything. Three consequences,
 * all fixed by moving the reads to where the request already is:
 *
 *   - nothing rendered before hydration, so the first paint was a spinner even
 *     for a user whose data was a few milliseconds away;
 *   - the auth check was a client-side redirect, which means a signed-out
 *     visitor saw the shell start to load before being sent to /login;
 *   - a workspace that does not exist, or belongs to someone else, threw a raw
 *     Postgres string out of `db/*.ts` into React. It is a 404, and now says so.
 *
 * The client half of the work — seeding the context, the `?model=` parameter,
 * the last model chosen on this device, assistant avatars — is in
 * `WorkspaceHydrator`, which renders its children immediately.
 */
interface WorkspaceLayoutProps {
  children: ReactNode
  params: { workspaceid: string }
}

export default async function WorkspaceLayout({
  children,
  params
}: WorkspaceLayoutProps) {
  const supabase = createClient(cookies())

  // `getUser` rather than `getSession`: this decides whether to serve the
  // workspace, so it has to be the answer the auth server gives, not whatever
  // is in the cookie.
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const data = await getWorkspaceData(params.workspaceid)

  if (!data) {
    notFound()
  }

  return (
    <WorkspaceHydrator data={data}>
      <Dashboard>{children}</Dashboard>
    </WorkspaceHydrator>
  )
}
