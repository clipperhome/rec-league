import { switchDeveloperProfileAction } from "@/app/actions/developer";
import { getCurrentCommissionerSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  developmentManagerEmail,
  isLocalDevelopmentRequest,
} from "@/lib/developer-tools";

type DeveloperLeague = {
  commissionerEmail: string | null;
  id: string;
  manager: { email: string; teamName: string } | null;
  name: string;
  slug: string;
  teamName: string | null;
};

export async function DeveloperMenu() {
  if (!(await isLocalDevelopmentRequest())) return null;

  let currentEmail: string | null = null;
  let leagues: DeveloperLeague[] = [];

  try {
    const [session, records] = await Promise.all([
      getCurrentCommissionerSession(),
      db.league.findMany({
        where: { archivedAt: null },
        orderBy: { updatedAt: "desc" },
        select: {
          commissionerEmail: true,
          id: true,
          name: true,
          slug: true,
          teamManagers: {
            where: {
              acceptedAt: { not: null },
              email: { startsWith: "dev-manager+" },
            },
            orderBy: { updatedAt: "desc" },
            select: {
              email: true,
              team: { select: { name: true } },
            },
            take: 1,
          },
          teams: {
            orderBy: { createdAt: "asc" },
            select: { name: true },
            take: 1,
          },
        },
        take: 6,
      }),
    ]);

    currentEmail = session?.email ?? null;
    leagues = records.map((league) => ({
      commissionerEmail: league.commissionerEmail,
      id: league.id,
      manager:
        league.teamManagers[0]?.email === developmentManagerEmail(league.id)
        ? {
            email: league.teamManagers[0].email,
            teamName: league.teamManagers[0].team.name,
          }
        : null,
      name: league.name,
      slug: league.slug,
      teamName: league.teams[0]?.name ?? null,
    }));
  } catch (error) {
    console.error("Could not load the development profile menu.", error);
  }

  return (
    <details className="group fixed bottom-20 right-3 z-[70] xl:bottom-4 xl:right-4">
      <summary className="ml-auto grid min-h-12 min-w-12 cursor-pointer list-none place-items-center rounded-full border border-white/20 bg-[#10231c] px-3 text-sm font-black tracking-[0.08em] text-white shadow-[0_12px_30px_rgba(16,35,28,.28)] transition hover:bg-[#0f5138] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#f4b942] group-open:bg-[#f4b942] group-open:text-[#10231c] [&::-webkit-details-marker]:hidden">
        DEV
      </summary>

      <aside
        aria-label="Development profile switcher"
        className="absolute bottom-14 right-0 max-h-[min(38rem,calc(100dvh-9rem))] w-[calc(100vw-3rem)] max-w-sm overflow-y-auto rounded-2xl border border-[#cad7cf] bg-white text-[#10231c] shadow-[0_24px_70px_rgba(16,35,28,.28)]"
      >
        <header className="sticky top-0 z-10 border-b border-[#d9e2dc] bg-white/95 px-5 py-4 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#0f6a48]">
                Local development
              </p>
              <h2 className="mt-1 text-xl font-bold tracking-[-0.03em]">
                View as a role
              </h2>
            </div>
            <span className="rounded-full bg-[#fff2c7] px-2.5 py-1 text-xs font-bold text-[#6c4a00]">
              DEV ONLY
            </span>
          </div>
          <div className="mt-3 min-w-0 text-sm leading-5 text-[#627068]">
            <p className="text-xs font-bold uppercase tracking-[0.1em]">
              Current browser
            </p>
            <p className="truncate" title={currentEmail ?? "public / signed out"}>
              {currentEmail ?? "public / signed out"}
            </p>
          </div>
        </header>

        <div className="space-y-3 p-3">
          {leagues.length ? (
            leagues.map((league) => {
              const organizerActive =
                currentEmail !== null &&
                league.commissionerEmail?.toLowerCase() === currentEmail;
              const managerActive =
                currentEmail !== null &&
                league.manager?.email.toLowerCase() === currentEmail;

              return (
                <section
                  className="rounded-xl border border-[#d9e2dc] bg-[#f8faf8] p-3"
                  key={league.id}
                >
                  <div className="min-w-0">
                    <p className="break-words font-bold">{league.name}</p>
                    <p className="mt-0.5 truncate text-xs text-[#627068]">
                      /l/{league.slug}
                    </p>
                  </div>

                  <div className="mt-3 grid min-w-0 gap-2">
                    <ProfileButton
                      active={organizerActive}
                      detail={league.commissionerEmail ?? "No organizer email"}
                      disabled={!league.commissionerEmail}
                      leagueId={league.id}
                      profile="organizer"
                      title="Organizer"
                    />
                    <ProfileButton
                      active={managerActive}
                      detail={
                        league.manager
                          ? `${league.manager.teamName} · ${league.manager.email}`
                          : league.teamName
                            ? `${league.teamName} · creates a local test manager`
                            : "Add a team first"
                      }
                      disabled={!league.manager && !league.teamName}
                      leagueId={league.id}
                      profile="manager"
                      title="Team manager"
                    />
                    <ProfileButton
                      detail="No login · public schedule and standings"
                      leagueId={league.id}
                      profile="public"
                      title="Players & families"
                    />
                  </div>
                </section>
              );
            })
          ) : (
            <div className="rounded-xl border border-dashed border-[#bdcbc2] p-4 text-sm leading-6 text-[#627068]">
              Create a league first. Its three development profiles will appear here.
            </div>
          )}
        </div>

        <p className="border-t border-[#d9e2dc] px-5 py-3 text-xs leading-5 text-[#627068]">
          This switcher is never rendered in a production build.
        </p>
      </aside>
    </details>
  );
}

function ProfileButton({
  active = false,
  detail,
  disabled = false,
  leagueId,
  profile,
  title,
}: {
  active?: boolean;
  detail: string;
  disabled?: boolean;
  leagueId: string;
  profile: "manager" | "organizer" | "public";
  title: string;
}) {
  return (
    <form action={switchDeveloperProfileAction} className="min-w-0">
      <input name="leagueId" type="hidden" value={leagueId} />
      <input name="profile" type="hidden" value={profile} />
      <button
        aria-current={active ? "page" : undefined}
        className={`flex min-h-14 min-w-0 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#f4b942] disabled:cursor-not-allowed disabled:opacity-45 ${
          active
            ? "border-[#0f5138] bg-[#e8f2ec]"
            : "border-[#cad7cf] bg-white hover:border-[#0f5138] hover:bg-[#f3f6f2]"
        }`}
        disabled={disabled}
        type="submit"
      >
        <span
          aria-hidden="true"
          className={`grid size-8 shrink-0 place-items-center rounded-lg text-sm font-black ${
            active ? "bg-[#0f5138] text-white" : "bg-[#e8eeea] text-[#0f5138]"
          }`}
        >
          {profile === "organizer" ? "O" : profile === "manager" ? "M" : "P"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 font-bold">
            {title}
            {active ? (
              <span className="rounded-full bg-[#0f5138] px-2 py-0.5 text-xs font-bold text-white">
                Current
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-xs text-[#627068]">
            {detail}
          </span>
        </span>
        <span aria-hidden="true" className="text-[#0f5138]">
          →
        </span>
      </button>
    </form>
  );
}
