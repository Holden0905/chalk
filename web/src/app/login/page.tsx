export const metadata = { title: "Chalk" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center">
      <h1 className="chalk d-wordmark font-bold">Chalk</h1>
      <hr className="chalk-rule mt-4 w-48" />

      <form action="/api/login" method="post" className="mt-8 w-full max-w-xs">
        <input type="hidden" name="next" value={next ?? "/board"} />
        <label htmlFor="password" className="label block">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          className="tabular panel mt-2 w-full px-3 py-2.5 text-base text-chalk outline-none focus:border-butter"
        />
        <button
          type="submit"
          className="chalk d-nav mt-4 w-full rounded-sm border border-chalk/25 px-3 py-2.5 font-bold hover:border-butter hover:text-butter"
        >
          Enter
        </button>
        {error ? (
          <p className="mt-3 text-center text-sm text-loss">That is not the password.</p>
        ) : null}
      </form>
    </div>
  );
}
