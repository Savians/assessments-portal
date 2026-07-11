import { redirect } from "next/navigation";

export const metadata = {
  title: "Client Dashboard | Savians Tax Assessment"
};

export default function PortalProfilePage() {
  redirect("/portal/dashboard");
}
