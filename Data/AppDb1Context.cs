using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using WebApplicationBase.Models.Entity.Db1;
#nullable disable

namespace WebApplicationBase.Data
{
    public class AppDb1Context : IdentityUserContext<T_Mst_User, int>
    {
        public AppDb1Context(DbContextOptions<AppDb1Context> options) : base(options)
        {
            Database.SetCommandTimeout(3600);
        }

        public virtual DbSet<T_Mst_User> T_Mst_User { get; set; }

        protected override void OnModelCreating(ModelBuilder builder)
        {
            base.OnModelCreating(builder);

            builder.Entity<T_Mst_User>(entity =>
            {
                entity.ToTable("T_Mst_User");
                entity.HasKey(e => e.Id);
            });
        }
    }
}
