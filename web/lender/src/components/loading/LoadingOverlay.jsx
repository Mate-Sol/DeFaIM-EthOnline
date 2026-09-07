export default function LoadingOverlay({ isLoading, status }) {
  if (!isLoading) return null;

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center z-50 bg-overlay">
      <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-white border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]"></div>
      {status && <div className="mt-4 text-white text-center">{status}</div>}
    </div>
  );
}
