import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  Clock3,
  FileText,
  Play,
  ShieldCheck,
  UsersRound,
  Wrench,
  Zap,
} from "lucide-react";
import Footer from "@/components/Footer";
import ApplianceGallery from "@/components/ApplianceGallery";
import HowItWorksSteps from "@/components/HowItWorksSteps";

/*
 * The homepage is deliberately short: hero, four trust points, three steps,
 * the appliance gallery, and one closing call to action. Detail that used to
 * live here (payments, support, the full nine-step flow) belongs on
 * /how-it-works and /services, where it has room to be read.
 *
 * Every claim below describes a capability the platform actually enforces. No
 * customer counts, ratings, or certifications are shown because none are
 * collected or verified.
 */
const trustPoints = [
  { icon: ShieldCheck, title: "Admin-Approved Technicians", body: "Profiles reviewed before joining the queue" },
  { icon: UsersRound, title: "Fair Queue System", body: "Rotation-based assignments" },
  { icon: FileText, title: "Transparent Estimates", body: "Approve costs upfront" },
  { icon: Clock3, title: "Service Tracking", body: "Updates from request to completion" },
];

export default function HomePage() {
  return (
    <div className="bg-[#070D12]">
      {/* Hero. The photograph is the same wide technician shot used before
          (`Backgound.jpg` is the real filename, there is no `Background.jpg`),
          now paired with a single directional navy scrim instead of the old
          badge, trust row, and floating caption competing with the headline. */}
      <section className="relative isolate overflow-hidden bg-[#070D12]">
        <Image
          src="/images/Backgound.jpg"
          alt="SPARKServ technician repairing a washing machine in a customer's home"
          fill
          priority
          quality={92}
          sizes="100vw"
          className="-z-20 object-cover object-[62%_58%]"
        />
        {/* The directional scrim holds the white copy at readable contrast on
            desktop. The flat navy layer is for phones, where the photo is
            cropped to portrait and the text sits directly over the technician. */}
        <div aria-hidden="true" className="hero-copy-scrim absolute inset-0 -z-10" />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[#070D12]/75 lg:hidden" />

        <div className="spark-section relative flex min-h-[440px] flex-col justify-center py-14 md:min-h-[480px] md:py-16">
          <div className="max-w-2xl">
            <h1 className="text-4xl font-bold leading-[1.08] text-white sm:text-5xl lg:text-[3.5rem]">
              Appliance Repair
              <br />
              <span className="text-[#81EDF4]">Made Simple</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-white/85 md:text-lg">
              Appliance repair for Cagayan de Oro. Submit a request, review the estimate, and follow each update in one place.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Link
                href="/customer/request-repair"
                className="inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-[#6D70F0] px-7 text-sm font-semibold text-white shadow-none transition-all duration-200 hover:bg-[#8587FF] active:scale-[0.98] sm:w-auto"
              >
                <Wrench className="h-4 w-4" />
                Request a Repair
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/how-it-works"
                className="inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2.5 rounded-full border border-[#81EDF4]/55 px-7 text-sm font-semibold text-white transition-all duration-200 hover:border-[#81EDF4] hover:bg-[#81EDF4]/10 sm:w-auto"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-white/60">
                  <Play className="h-2.5 w-2.5 fill-current" />
                </span>
                How It Works
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Trust strip. Four capabilities in one row on desktop, a 2x2 grid on
          phones, so it adds a band rather than a section of its own. */}
      <section aria-label="Why SPARKServ" className="border-t border-white/10 bg-[#0B1118] text-white">
        <div className="spark-section">
          <ul className="grid grid-cols-2 md:grid-cols-4">
            {trustPoints.map((point, index) => (
              <li
                key={point.title}
                className={`flex min-w-0 items-center gap-3 py-4 md:px-5 md:py-5 ${
                  index >= 2 ? "border-t border-white/10 md:border-t-0" : ""
                } ${index > 0 ? "md:border-l md:border-white/10" : ""} ${
                  index % 2 === 1 ? "border-l border-white/10 pl-4 md:pl-5" : ""
                }`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-[#81EDF4] ring-1 ring-inset ring-white/10">
                  <point.icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold leading-tight text-white">{point.title}</p>
                  <p className="mt-1 text-[11px] leading-snug text-white/60">{point.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* How It Works. The two-column section lives in `HowItWorksSteps`: the picture
          panel on the left, the steps as an accordion on the right, one accent colour. */}
      <HowItWorksSteps />

      {/* Supported Appliances. The gallery and its category data live in
          `ApplianceGallery`, which reads the shared `APPLIANCES` catalogue. */}
      <ApplianceGallery />

      {/* Final CTA. One blue band, one action, the section is a button target,
          not another feature block. */}
      <section className="bg-[#6D70F0] text-white">
        <div className="spark-section flex flex-col gap-5 py-8 sm:flex-row sm:items-center sm:justify-between md:py-10">
          <div className="flex items-center gap-4">
            <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[#81EDF4] ring-1 ring-inset ring-white/20 sm:flex">
              <Zap className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-2xl font-bold leading-tight sm:text-3xl">Ready to Get Your Appliance Fixed?</h2>
              <p className="mt-1 text-sm text-white/80">Start with your appliance information and describe the problem.</p>
            </div>
          </div>
          <Link
            href="/customer/request-repair"
            className="inline-flex h-11 w-full shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full bg-[#070D12] px-6 text-sm font-semibold text-white ring-1 ring-inset ring-white/15 transition-colors duration-200 hover:bg-[#101923] active:scale-[0.98] sm:w-auto"
          >
            Request a Repair
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <Footer variant="landing" />
    </div>
  );
}

