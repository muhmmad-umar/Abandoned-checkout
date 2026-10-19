import { SignUp } from "@clerk/nextjs";

export default function Page() {
  return (
    <main className="grid min-h-screen place-items-center p-4">
      <SignUp />
    </main>
  );
}
