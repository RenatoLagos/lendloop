import { Nav } from "@/components/Nav";
import { EnsureUser } from "@/components/EnsureUser";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <EnsureUser>{children}</EnsureUser>
      </main>
    </>
  );
}
