import { LoginForm } from "@/components/login-form";
import { authConfigured } from "@/lib/auth";

export default function LoginPage() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background p-6">
      <LoginForm configured={authConfigured()} />
    </div>
  );
}
