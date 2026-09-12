export const metadata = { title: "Offline · Chalk" };

export default function OfflinePage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <h1 className="chalk text-5xl leading-none font-bold">Board&rsquo;s wiped</h1>
      <hr className="chalk-rule mt-4 w-56" />
      <p className="mt-5 max-w-xs text-sm text-chalk-soft">
        No connection. The numbers live on the server, so there is nothing to
        show until you are back.
      </p>
    </div>
  );
}
