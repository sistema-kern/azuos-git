import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { motion } from "framer-motion";

export function PageLayout({ children, hideFooter = false }: { children: React.ReactNode, hideFooter?: boolean }) {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Navbar />
      <motion.main 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="flex-grow pt-20" // padding top for fixed navbar
      >
        {children}
      </motion.main>
      {!hideFooter && <Footer />}
    </div>
  );
}
