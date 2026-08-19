using Microsoft.EntityFrameworkCore;
using WebApplicationBase.Models.Entity.Db2;

#nullable disable

namespace WebApplicationBase.Data
{
    public class AppDb2Context : DbContext
    {
        public AppDb2Context(DbContextOptions<AppDb2Context> options) : base(options)
        {
            Database.SetCommandTimeout(3600);
        }

        public virtual DbSet<T_Mst_Etc> T_Mst_Etc { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<T_Mst_Etc>(entity =>
            {
                entity.ToTable("T_Mst_Etc");

                entity.HasKey(e => new
                {
                    e.Mst_Id,
                    e.Mst_Key1
                });
            });
        }
    }
}