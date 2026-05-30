import { useState } from "react";
import { Link } from "wouter";
import { useGetLeads } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Upload, Search } from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";

export default function Leads() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 500);

  const { data, isLoading } = useGetLeads({ 
    page, 
    limit: 10,
    ...(debouncedSearch ? { search: debouncedSearch } : {})
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Leads</h2>
          <p className="text-muted-foreground mt-1">Manage your vehicle shipping prospects.</p>
        </div>
        <Button asChild className="gap-2">
          <Link href="/leads/import">
            <Upload className="h-4 w-4" />
            Import Leads
          </Link>
        </Button>
      </div>

      <div className="flex items-center gap-2 max-w-sm">
        <div className="relative w-full">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search by name or email..." 
            className="pl-9" 
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1); // reset to page 1 on search
            }}
          />
        </div>
      </div>

      <div className="rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead>Route</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array(5).fill(0).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                </TableRow>
              ))
            ) : data?.data?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center h-32 text-muted-foreground">
                  No leads found.
                </TableCell>
              </TableRow>
            ) : (
              data?.data?.map(lead => (
                <TableRow key={lead.id}>
                  <TableCell className="font-medium">{lead.name}</TableCell>
                  <TableCell>{lead.email}</TableCell>
                  <TableCell>{lead.vehicle || "-"}</TableCell>
                  <TableCell>
                    {lead.pickup && lead.delivery ? `${lead.pickup} → ${lead.delivery}` : (lead.route || "-")}
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      lead.status === 'drafted' ? 'bg-green-500/10 text-green-500' : 
                      lead.status === 'failed' ? 'bg-red-500/10 text-red-500' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {lead.status}
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      
      <div className="flex items-center justify-between">
        <Button 
          variant="outline" 
          size="sm" 
          disabled={page === 1}
          onClick={() => setPage(p => p - 1)}
        >
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {data?.page || 1} of {Math.ceil((data?.total || 0) / 10) || 1}
        </span>
        <Button 
          variant="outline" 
          size="sm" 
          disabled={page >= Math.ceil((data?.total || 0) / 10)}
          onClick={() => setPage(p => p + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}