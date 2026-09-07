import { Outlet } from "react-router-dom";
import MainHeader from "./MainHeader";
import AuthProtection from "../navigation/AuthProtection";

export function AppLayout() {
  return (
    <AuthProtection>
      {/* min-h-screen allows the page to grow, flex-col keeps the structure */}
      <div className="min-h-screen flex flex-col text-slate-100">
        {/* Sticky Header:
          - sticky + top-0: Locks it to the top.
          - z-50: Ensures it stays on top of the images/content.
          - bg-inherit or a specific color: Prevents content from showing through the header.
      */}
        <header className="sticky top-0 z-50  backdrop-blur-xs">
          <MainHeader />
        </header>

        {/* Main Content:
          - Removed overflow-hidden so the whole page scrolls.
          - flex-1 makes sure this area fills the screen.
      */}
        <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8 flex-1">
          <Outlet />
        </main>
      </div>
    </AuthProtection>
  );
}

// ============================================
// export function AppLayout() {
//   return (
//     <div className="h-screen flex flex-col text-slate-100 overflow-hidden ">
//       <MainHeader />
//       <main className="flex-1 overflow-auto no-scrollbar ">
//         <Outlet />
//       </main>
//     </div>
//   );
// }

// ============================================
// export function AppLayout() {
//   return (
//     <div className="min-h-screen text-slate-100">
//       <MainHeader />
//       <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
//         <Outlet />
//       </main>
//     </div>
//   );
// }
