import { CreateBusinessForm } from "@/features/onboarding/components/CreateBusinessForm";

/**
 * Create-a-business recovery route (audit #13). Lives under the (app) group so
 * AppLayout's session guard applies — only a signed-in user reaches it. A user
 * with no business is routed here from sign-in instead of the dead-end "/".
 */
export default function StartPage() {
  return <CreateBusinessForm />;
}
