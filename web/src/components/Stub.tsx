export default function Stub({ title, phase, children }: { title: string; phase: string; children: React.ReactNode }) {
  return (
    <>
      <h1 className="chalk d-title font-bold">{title}</h1>
      <div className="panel mt-6 px-4 py-6">
        <p className="label">{phase}</p>
        <p className="mt-2 max-w-prose text-sm text-chalk-soft">{children}</p>
      </div>
    </>
  );
}
